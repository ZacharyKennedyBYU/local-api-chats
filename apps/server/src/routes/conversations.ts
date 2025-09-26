import { Router } from 'express';
import { getDb } from '../lib/db';

export const conversationsRouter = Router();

conversationsRouter.get('/', (req, res) => {
	const db = getDb();
	const profileId = req.query.profileId ? Number(req.query.profileId) : undefined;
	const rows = profileId
		? db.prepare('SELECT * FROM conversations WHERE profile_id = ? ORDER BY updated_at DESC').all(profileId)
		: db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all();
	res.json(rows);
});

conversationsRouter.get('/:id/messages', (req, res) => {
	const db = getDb();
	const id = Number(req.params.id);
	const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
	if (!conv) return res.status(404).json({ error: 'Not found' });
	const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC').all(id);
	res.json({ conversation: conv, messages });
});

conversationsRouter.delete('/:id', (req, res) => {
	const db = getDb();
	const id = Number(req.params.id);
	db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
	res.json({ ok: true });
});

