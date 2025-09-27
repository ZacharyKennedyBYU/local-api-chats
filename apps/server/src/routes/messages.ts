import { Router, Request, Response } from 'express';
import { getDb } from '../lib/db';

export const messagesRouter = Router();

// Update message content and optionally role
messagesRouter.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  const { content, role } = req.body || {};
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  const newContent = typeof content === 'string' ? content : msg.content;
  const newRole = role === 'system' || role === 'user' || role === 'assistant' ? role : msg.role;
  db.prepare('UPDATE messages SET content = ?, role = ? WHERE id = ?').run(newContent, newRole, id);
  // bump conversation updated_at
  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(msg.conversation_id);
  res.json({ ok: true });
});

// Delete a message
messagesRouter.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  // bump conversation updated_at
  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(msg.conversation_id);
  res.json({ ok: true });
});

