import { Router, Request, Response } from 'express';
import { getDb } from '../lib/db';

export const conversationsRouter = Router();

conversationsRouter.get('/', (req: Request, res: Response) => {
	const db = getDb();
	const profileId = req.query.profileId ? Number(req.query.profileId) : undefined;
	const rows = profileId
		? db.prepare('SELECT * FROM conversations WHERE profile_id = ? ORDER BY updated_at DESC').all(profileId)
		: db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all();
	res.json(rows);
});

conversationsRouter.get('/:id/messages', (req: Request, res: Response) => {
	const db = getDb();
	const id = Number(req.params.id);
	const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
	if (!conv) return res.status(404).json({ error: 'Not found' });
	const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC').all(id);
	res.json({ conversation: conv, messages });
});

conversationsRouter.delete('/:id', (req: Request, res: Response) => {
	const db = getDb();
	const id = Number(req.params.id);
	db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
	res.json({ ok: true });
});

// Rename conversation
conversationsRouter.put('/:id', (req: Request, res: Response) => {
	const db = getDb();
	const id = Number(req.params.id);
	const { title, model } = req.body || {};
	const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
	if (!conv) return res.status(404).json({ error: 'Not found' });
	const nextTitle = typeof title === 'string' ? title : conv.title;
	const nextModel = typeof model === 'string' ? model : conv.model;
	db.prepare('UPDATE conversations SET title = ?, model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nextTitle, nextModel, id);
	res.json({ ok: true });
});

