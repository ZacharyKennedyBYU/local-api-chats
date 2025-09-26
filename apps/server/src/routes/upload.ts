import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const uploadDir = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
	fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
	destination: (_req, _file, cb) => cb(null, uploadDir),
	filename: (_req, file, cb) => {
		const timestamp = Date.now();
		const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
		cb(null, `${timestamp}-${safeName}`);
	}
});

const upload = multer({ storage });

export const uploadRouter = Router();

uploadRouter.post('/', upload.single('file'), (req, res) => {
	if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
	const file = req.file;
	res.json({
		filename: file.filename,
		mimetype: file.mimetype,
		path: file.path,
		size: file.size
	});
});

