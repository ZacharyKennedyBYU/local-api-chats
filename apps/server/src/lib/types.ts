export interface ProfileRow {
	id: number;
	name: string;
	api_base_url: string;
	api_key: string;
	settings_json: string;
	created_at: string;
	updated_at: string;
}

export interface ConversationRow {
	id: number;
	profile_id: number;
	title: string | null;
	model: string | null;
	created_at: string;
	updated_at: string;
}

export interface MessageRow {
	id: number;
	conversation_id: number;
	role: 'system' | 'user' | 'assistant';
	content: string;
	token_count: number | null;
	created_at: string;
}

