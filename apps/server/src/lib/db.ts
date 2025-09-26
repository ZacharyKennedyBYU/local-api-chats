import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
	if (!dbInstance) {
		const dbPathEnv = process.env.DATABASE_PATH || './data/app.db';
		const dbPath = path.isAbsolute(dbPathEnv)
			? dbPathEnv
			: path.resolve(process.cwd(), dbPathEnv);
		const dir = path.dirname(dbPath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		dbInstance = new Database(dbPath);
		dbInstance.pragma('journal_mode = WAL');
	}
	return dbInstance;
}

export function ensureDatabaseInitialized(): void {
	const db = getDb();
	// Profiles store API base URL, API key (encrypted later), default params, and options toggles
	db.prepare(`
		CREATE TABLE IF NOT EXISTS profiles (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			api_base_url TEXT NOT NULL,
			api_key TEXT NOT NULL,
			settings_json TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`).run();

	// Conversations belong to a profile and track title and selected model
	db.prepare(`
		CREATE TABLE IF NOT EXISTS conversations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			profile_id INTEGER NOT NULL,
			title TEXT,
			model TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
		)
	`).run();

	// Messages belong to a conversation
	db.prepare(`
		CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			conversation_id INTEGER NOT NULL,
			role TEXT NOT NULL,
			content TEXT NOT NULL,
			token_count INTEGER,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
		)
	`).run();

	// Attachments that can be linked to messages
	db.prepare(`
		CREATE TABLE IF NOT EXISTS attachments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			message_id INTEGER NOT NULL,
			filename TEXT NOT NULL,
			mimetype TEXT NOT NULL,
			path TEXT NOT NULL,
			size INTEGER NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
		)
	`).run();
}

