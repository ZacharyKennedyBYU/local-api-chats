import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { profilesRouter } from './routes/profiles';
import { chatRouter } from './routes/chat';
import { conversationsRouter } from './routes/conversations';
import { messagesRouter } from './routes/messages';
import { uploadRouter } from './routes/upload';
import { ensureDatabaseInitialized } from './lib/db';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));

const uploadDir = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
	fs.mkdirSync(uploadDir, { recursive: true });
}

ensureDatabaseInitialized();

app.use('/api/profiles', profilesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/upload', uploadRouter);

// Backwards-compatible alias without /api prefix
app.use('/chat', chatRouter);

app.get('/api/health', (_req, res) => {
	res.json({ ok: true });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
	console.log(`[server] listening on http://localhost:${port}`);
});

