import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../lib/db';
import { ProfileRow } from '../lib/types';
import fs from 'fs';
import path from 'path';

export const chatRouter = Router();

const ContentPart = z.discriminatedUnion('type', [
	z.object({ type: z.literal('text'), text: z.string() }),
	z.object({ type: z.literal('image_url'), image_url: z.object({ url: z.string() }) }),
	z.object({ type: z.literal('image_path'), path: z.string(), mimetype: z.string().optional() })
]);

const ChatMessage = z.object({
	role: z.enum(['system', 'user', 'assistant']),
	content: z.string().optional(),
	parts: z.array(ContentPart).optional()
});

const ChatRequest = z.object({
	profileId: z.number().int(),
	conversationId: z.number().int().optional(),
	model: z.string().min(1).optional(),
	messages: z.array(ChatMessage).min(1),
	params: z.object({
		max_context: z.number().int().positive().optional(),
		max_output_tokens: z.number().int().positive().optional(),
		temperature: z.number().min(0).max(2).optional(),
		top_p: z.number().min(0).max(1).optional(),
		top_k: z.number().int().min(1).optional(),
		frequency_penalty: z.number().min(-2).max(2).optional(),
		presence_penalty: z.number().min(-2).max(2).optional(),
		stream: z.boolean().optional(),
		include_settings: z.record(z.boolean()).optional(),
		embed_images_as_base64: z.boolean().optional()
	}).default({})
});

// Helper to build request body with toggles
function buildRequestBody(base: any, include: Record<string, boolean> | undefined): any {
	if (!include) return base;
	const filtered: any = {};
	for (const [key, value] of Object.entries(base)) {
		if (key === 'messages' || key === 'model') {
			filtered[key] = value;
			continue;
		}
		if (include[key] !== false) {
			filtered[key] = value;
		}
	}
	return filtered;
}

chatRouter.post('/', async (req, res) => {
	const parsed = ChatRequest.safeParse(req.body);
	if (!parsed.success) {
		return res.status(400).json({ error: parsed.error.flatten() });
	}
	const { profileId, conversationId, model, messages, params } = parsed.data;
	const db = getDb();
	const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId) as ProfileRow | undefined;
	if (!profile) return res.status(404).json({ error: 'Profile not found' });

	const baseUrl = String(profile.api_base_url).replace(/\/$/, '');
	const apiKey = String(profile.api_key);

	// Merge default settings with request-level params
	const defaultSettings = JSON.parse(profile.settings_json || '{}');
	const include = params.include_settings || defaultSettings.include_settings || {};
	const merged = { ...defaultSettings, ...params };

	// Transform messages to support text+image parts using OpenAI Chat API format
	const apiMessages = await Promise.all(messages.map(async (m) => {
		if (!m.parts || m.parts.length === 0) {
			return { role: m.role, content: m.content ?? '' };
		}
		const content: any[] = [];
		if (m.content) {
			content.push({ type: 'text', text: m.content });
		}
		for (const p of m.parts) {
			if (p.type === 'text') {
				content.push({ type: 'text', text: p.text });
			} else if (p.type === 'image_url') {
				content.push({ type: 'image_url', image_url: { url: p.image_url.url } });
			} else if (p.type === 'image_path') {
				try {
					const abs = path.isAbsolute(p.path) ? p.path : path.resolve(process.cwd(), p.path);
					const data = await fs.promises.readFile(abs);
					const mime = p.mimetype || 'image/png';
					const b64 = data.toString('base64');
					content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } });
				} catch {
					// ignore individual file errors, continue
				}
			}
		}
		return { role: m.role, content };
	}));

	const reqBody: any = buildRequestBody({
		model: model || merged.model,
		messages: apiMessages,
		max_context: merged.max_context,
		max_tokens: merged.max_output_tokens,
		temperature: merged.temperature,
		top_p: merged.top_p,
		top_k: merged.top_k,
		frequency_penalty: merged.frequency_penalty,
		presence_penalty: merged.presence_penalty,
		stream: merged.stream
	}, include);

	try {
		const url = `${baseUrl}/v1/chat/completions`;
		const resp = await fetch(url, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(reqBody)
		});
		if (!resp.ok) {
			const text = await resp.text();
			return res.status(resp.status).json({ error: text });
		}
		const data = await resp.json();

		// Persist conversation and messages
		let convId = conversationId;
		if (!convId) {
			const firstUser = messages.find(m => m.role === 'user');
			const title = (firstUser?.content || '').slice(0, 80) || 'New Chat';
			const info = db.prepare('INSERT INTO conversations (profile_id, title, model) VALUES (?, ?, ?)')
				.run(profileId, title, reqBody.model ?? null);
			convId = Number(info.lastInsertRowid);
		}
		// Insert incoming user messages in request
		const insertMsg = db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)');
		for (const m of messages) {
			insertMsg.run(convId, m.role, m.content);
		}
		// Extract assistant message
		let assistant = '';
		if (Array.isArray(data?.choices) && data.choices.length > 0) {
			const msg = data.choices[0]?.message;
			if (typeof msg?.content === 'string') assistant = msg.content;
			else if (Array.isArray(msg?.content)) {
				assistant = msg.content.map((p: any) => (p?.text ? p.text : '')).join('');
			}
		}
		insertMsg.run(convId, 'assistant', assistant);

		res.json({ conversationId: convId, response: data });
	} catch (e: any) {
		res.status(500).json({ error: e?.message || 'Chat request failed' });
	}
});

