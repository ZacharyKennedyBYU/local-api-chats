import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../lib/db';
import { ProfileRow } from '../lib/types';

export const profilesRouter = Router();

const ProfileInput = z.object({
	name: z.string().min(1),
	api_base_url: z.string().url(),
	api_key: z.string().min(1),
	settings: z.object({
		max_context: z.number().int().positive().optional(),
		max_output_tokens: z.number().int().positive().optional(),
		temperature: z.number().min(0).max(2).optional(),
		top_p: z.number().min(0).max(1).optional(),
		top_k: z.number().int().min(1).optional(),
		frequency_penalty: z.number().min(-2).max(2).optional(),
		presence_penalty: z.number().min(-2).max(2).optional(),
		stream: z.boolean().optional(),
		include_settings: z.record(z.boolean()).optional()
	}).default({})
});

profilesRouter.get('/', (_req, res) => {
	const db = getDb();
	const rows = db.prepare('SELECT id, name, api_base_url, settings_json, created_at, updated_at FROM profiles ORDER BY id DESC').all();
	res.json(rows.map((r: any) => ({
		...r,
		settings: JSON.parse(r.settings_json)
	})));
});

profilesRouter.post('/', (req, res) => {
	const parsed = ProfileInput.safeParse(req.body);
	if (!parsed.success) {
		return res.status(400).json({ error: parsed.error.flatten() });
	}
	const { name, api_base_url, api_key, settings } = parsed.data;
	const db = getDb();
	const stmt = db.prepare(`
		INSERT INTO profiles (name, api_base_url, api_key, settings_json)
		VALUES (@name, @api_base_url, @api_key, @settings_json)
	`);
	const info = stmt.run({ name, api_base_url, api_key, settings_json: JSON.stringify(settings ?? {}) });
	res.json({ id: info.lastInsertRowid });
});

profilesRouter.put('/:id', (req, res) => {
	const id = Number(req.params.id);
	const parsed = ProfileInput.partial().safeParse(req.body);
	if (!parsed.success) {
		return res.status(400).json({ error: parsed.error.flatten() });
	}
	const updates = parsed.data;
	const db = getDb();
	const current = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as ProfileRow | undefined;
	if (!current) return res.status(404).json({ error: 'Not found' });
	const next = {
		name: updates.name ?? current.name,
		api_base_url: updates.api_base_url ?? current.api_base_url,
		api_key: updates.api_key ?? current.api_key,
		settings_json: JSON.stringify(updates.settings ?? JSON.parse(current.settings_json))
	};
	db.prepare(`
		UPDATE profiles SET name=@name, api_base_url=@api_base_url, api_key=@api_key, settings_json=@settings_json, updated_at=CURRENT_TIMESTAMP WHERE id=${id}
	`).run(next);
	res.json({ ok: true });
});

profilesRouter.delete('/:id', (req, res) => {
	const id = Number(req.params.id);
	const db = getDb();
	db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
	res.json({ ok: true });
});

profilesRouter.get('/:id/models', async (req, res) => {
	const id = Number(req.params.id);
	const db = getDb();
	const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as ProfileRow | undefined;
	if (!profile) return res.status(404).json({ error: 'Not found' });

	try {
		// Normalize base URL so we do not duplicate version segments
		const base = String(profile.api_base_url).replace(/\/+$/, '');
		const alreadyVersioned = /\/(v\d+|openai\/v\d+)$/.test(base);
		const url = `${base}${alreadyVersioned ? '' : '/v1'}/models`;
		const resp = await fetch(url, {
			headers: {
				'Authorization': `Bearer ${profile.api_key}`,
				'Content-Type': 'application/json'
			}
		});
		if (!resp.ok) {
			const text = await resp.text();
			return res.status(resp.status).json({ error: text });
		}
		const data = await resp.json().catch(() => null);
		// Support common schemas: direct array, {data: [...]}, {models: [...]}
		const models = Array.isArray(data)
			? data
			: Array.isArray((data as any)?.data)
				? (data as any).data
				: Array.isArray((data as any)?.models)
					? (data as any).models
					: [];
		res.json(models);
	} catch (e: any) {
		res.status(500).json({ error: e?.message || 'Failed to fetch models' });
	}
});

