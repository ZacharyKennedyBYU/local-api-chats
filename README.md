# Local API Chats

Local, ChatGPT-style chat UI that can talk to arbitrary OpenAI-compatible APIs by entering a base URL and API key. Includes saved profiles, per-profile settings, chat history database, and image uploads.

## Features

- Profiles with API base URL and API key; quickly switch between them
- Discover models from each profile (`GET /v1/models`)
- ChatGPT-like UI (sidebar with profiles, chat view, composer)
- Image upload (as data URLs to compatible chat APIs)
- Per-profile settings: max context, max response tokens, temperature, top_p, top_k, frequency/presence penalty, stream, and inclusion toggles
- SQLite persistence for profiles, conversations, messages, attachments

## Monorepo structure

- `apps/server`: Express + TypeScript + better-sqlite3 backend
- `apps/client`: React + Vite + Tailwind v4 frontend

## Prerequisites

- Node.js 18+ and npm 9+

## Setup

1. Install dependencies

```bash
npm install
```

2. Configure server environment

```bash
cp apps/server/.env.example apps/server/.env
# Edit apps/server/.env if needed (PORT, DATABASE_PATH, UPLOAD_DIR)
```

3. Build server and client

```bash
npm run build
```

4. Start development (server + client)

```bash
npm run dev
```

By default, server runs on http://localhost:3001 and client on http://localhost:5173

## Usage

1. Open the client (http://localhost:5173)
2. Create a Profile with:
   - Name
   - API Base URL (e.g. https://api.openai.com)
   - API Key
3. Select the profile to load models. Choose a model if desired.
4. Start chatting. Use Upload to include an image (sent as data URL content part).

## API (server)

- `GET /api/health`
- `GET /api/profiles`
- `POST /api/profiles` body: { name, api_base_url, api_key, settings? }
- `PUT /api/profiles/:id`
- `DELETE /api/profiles/:id`
- `GET /api/profiles/:id/models`
- `POST /api/chat` body: { profileId, conversationId?, model?, messages, params }
- `POST /api/upload` multipart form-data with field `file`
- `GET /api/conversations?profileId=...`
- `GET /api/conversations/:id/messages`
- `DELETE /api/conversations/:id`

Messages support text and images using OpenAI content parts:

```json
{
  "role": "user",
  "content": "Describe this image",
  "parts": [
    { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
  ]
}
```

## GitHub compatibility

- `.gitignore` included
- Run `npm run build` in CI to verify server and client
- You can deploy the server standalone if desired; client is a static build in `apps/client/dist`

## Notes

- The server expects OpenAI-compatible endpoints: `/v1/models` and `/v1/chat/completions`.
- Settings are merged and filtered by `include_settings` toggles before sending.
- Images are sent as `image_url` data URLs.

