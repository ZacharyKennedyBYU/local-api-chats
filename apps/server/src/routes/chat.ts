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
		embed_images_as_base64: z.boolean().optional(),
		debug: z.boolean().optional(),
		system_prompt: z.string().optional()
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

	// Normalize base URL similar to models route to avoid duplicate version segments
	const rawBaseUrl = String(profile.api_base_url).replace(/\/+$/, '');
	const alreadyVersioned = /\/(v\d+|openai\/v\d+)$/.test(rawBaseUrl);
	const baseUrl = `${rawBaseUrl}${alreadyVersioned ? '' : '/v1'}`;
	const apiKey = String(profile.api_key);

	// Merge default settings with request-level params
	const defaultSettings = JSON.parse(profile.settings_json || '{}');
	const include = params.include_settings || defaultSettings.include_settings || {};
	const merged = { ...defaultSettings, ...params };

	// If a system prompt is provided and the first message isn't system, prepend it
	const withSystem = (() => {
		if (params.system_prompt && (messages.length === 0 || messages[0].role !== 'system')) {
			return [{ role: 'system', content: params.system_prompt } as any, ...messages];
		}
		return messages;
	})();

	// Transform messages to support text+image parts using OpenAI Chat API format
	const apiMessages = await Promise.all(withSystem.map(async (m) => {
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
		max_tokens: merged.max_output_tokens,
		temperature: merged.temperature,
		top_p: merged.top_p,
		frequency_penalty: merged.frequency_penalty,
		presence_penalty: merged.presence_penalty,
		stream: merged.stream
	}, include);

	try {
		// Try common OpenAI-compatible endpoints, falling back if the first 404s
		const candidatePaths = ['/chat/completions', '/completions'];
		let upstreamResp: Response | null = null;
		let url = '';
		for (const suffix of candidatePaths) {
			url = `${baseUrl}${suffix}`;
			upstreamResp = await fetch(url, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
					'Accept': merged.stream ? 'text/event-stream' : 'application/json'
				},
				body: JSON.stringify(reqBody)
			});
			if (upstreamResp.status !== 404) break;
		}
		// Safety: if still null, throw generic error
		if (!upstreamResp) throw new Error('No upstream response');

		// If streaming requested, proxy as SSE to the client
		if (merged.stream) {
			if (!upstreamResp.ok || !upstreamResp.body) {
				const raw = await upstreamResp.text().catch(() => '');
				let parsedErr: any = null;
				try { parsedErr = raw ? JSON.parse(raw) : null; } catch {}
				const payload = (parsedErr && (parsedErr.error || parsedErr)) || raw || 'Upstream error';
				return res.status(upstreamResp.status).json({ error: payload, ...(merged.debug ? { debug: { url, body: reqBody } } : {}) });
			}

			// Prepare conversation and persist user messages up-front
			let convId = conversationId as number | undefined;
			if (!convId) {
				const firstUser = messages.find(m => m.role === 'user');
				const title = (firstUser?.content || '').slice(0, 80) || 'New Chat';
				const info = db.prepare('INSERT INTO conversations (profile_id, title, model) VALUES (?, ?, ?)')
					.run(profileId, title, reqBody.model ?? null);
				convId = Number(info.lastInsertRowid);
			}
			const insertMsg = db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)');
			for (const m of messages) {
				insertMsg.run(convId!, m.role, m.content);
			}

			// SSE headers
			res.setHeader('Content-Type', 'text/event-stream');
			res.setHeader('Cache-Control', 'no-cache, no-transform');
			res.setHeader('Connection', 'keep-alive');
			(res as any).flushHeaders?.();

			const send = (event: string, data: any) => {
				try {
					res.write(`event: ${event}\n`);
					res.write(`data: ${JSON.stringify(data)}\n\n`);
				} catch {}
			};

			// Send meta information first
			send('meta', { conversationId: convId, model: reqBody.model ?? null });
			if (merged.debug) send('debug', { stage: 'upstream_request', url, body: reqBody });

			const reader = (upstreamResp.body as any).getReader();
			const decoder = new TextDecoder();
			let assistantText = '';
			let buffer = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let idx;
				while ((idx = buffer.indexOf('\n\n')) !== -1) {
					const rawEvent = buffer.slice(0, idx);
					buffer = buffer.slice(idx + 2);
					const lines = rawEvent.split('\n').map(l => l.trim());
					for (const line of lines) {
						if (!line.startsWith('data:')) continue;
						const payload = line.slice(5).trim();
						if (payload === '[DONE]') {
							// finish
							break;
						}
						try {
							const obj = JSON.parse(payload);
							let delta = '';
							if (Array.isArray(obj?.choices) && obj.choices.length > 0) {
								const choice = obj.choices[0];
								if (typeof choice?.delta?.content === 'string') delta = choice.delta.content;
								else if (typeof choice?.text === 'string') delta = choice.text;
								else if (typeof choice?.message?.content === 'string') delta = choice.message.content;
								else if (Array.isArray(choice?.message?.content)) {
									delta = choice.message.content.map((p: any) => (p?.text ? p.text : '')).join('');
								}
							}
							if (typeof obj?.delta?.content === 'string') delta = obj.delta.content || delta;
							if (delta) {
								assistantText += delta;
								send('chunk', { content: delta });
							}
							if (merged.debug) send('debug', { stage: 'upstream_chunk', raw: obj });
						} catch {
							if (merged.debug) send('debug', { stage: 'chunk_parse_error', raw: payload });
						}
					}
				}
			}

			// Save assistant message and finish
			const insertAssistant = db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)');
			insertAssistant.run(convId!, 'assistant', assistantText);
			send('done', { conversationId: convId });
			return res.end();
		}

		// Non-streaming path
		if (!upstreamResp.ok) {
			const raw = await upstreamResp.text().catch(() => '');
			let parsedErr: any = null;
			try { parsedErr = raw ? JSON.parse(raw) : null; } catch {}
			const payload = (parsedErr && (parsedErr.error || parsedErr)) || raw || 'Upstream error';
			return res.status(upstreamResp.status).json({ error: payload, ...(merged.debug ? { debug: { url, body: reqBody } } : {}) });
		}
		const data = await upstreamResp.json();

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

