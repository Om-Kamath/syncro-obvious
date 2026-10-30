<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Syncro

A narration-first video editor in the browser: import clips, generate narration and TTS with Gemini, arrange a multi-track timeline, and export finished video with captions, thumbnails, and metadata.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`
3. On first launch, click the key icon in the header and paste your Gemini API key.
   The key is stored in your browser's local storage (`syncro_gemini_api_key`) — it never leaves your machine and no `.env` file is needed.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server on port 3000 |
| `npm run server:dev` | Start the Syncro API server on port 3001 (watch mode) |
| `npm run server:start` | Start the API server without watch |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm test` | Run Vitest tests |
| `npm run lint` | Type-check (`tsc --noEmit`) + ESLint |
| `npm run lint:eslint` | ESLint only |
| `npm run typecheck` | Type-check only (`tsc --noEmit`) |
| `npm run test:e2e` | Playwright e2e suite (Chromium; starts the dev server on :3000) |
| `npm run mcp` | Start the MCP server (stdio) for agent-driven generation |
| `npm run mcp:http` | Run the MCP server over streamable HTTP (default port 3010) |
| `npm run clean` | Remove `dist/` |

## Media API

The API server (port 3001) stores uploaded media blobs on disk:

- `POST /api/media` — the raw request body is the blob (no multipart); optional `?filename=`
  query param or `x-filename` header names it. Returns 201 with `{ id, filename, mimeType, size, createdAt }`.
- `GET /api/media/:id` — serves the bytes with HTTP range support (206 partial responses,
  `Accept-Ranges: bytes`) so `<video>` elements can seek. `HEAD` is supported.
- Out-of-range requests get 416; uploads over the size cap get 413.

Configuration: `SYNCRO_MEDIA_DIR` (blob directory, default `data/media`) and
`SYNCRO_MAX_UPLOAD_BYTES` (default 536870912 = 512 MiB). Both can also be passed per app
instance through `createApp` options.

## CI

Every push and PR runs four checks in parallel, one job each in
`.github/workflows/ci.yml`:

| Check | What it runs |
| --- | --- |
| `lint` | ESLint (`npm run lint:eslint`) |
| `typecheck` | `tsc --noEmit` (`npm run typecheck`) |
| `unit` | Vitest suite with v8 coverage + production build |
| `e2e` | Playwright smoke suite in Chromium (`npm run test:e2e`) |

A fifth job, `gate`, passes only when all four pass — and it reports even when
one of them fails or is cancelled, so it can never silently go missing. On a
new push to the same branch, the superseded run is cancelled immediately.

Branch protection on `main` should require only the `gate` check: adding,
removing, or renaming a job then never needs a settings change. To list the
individual checks as required too, mark `lint`, `typecheck`, `unit`, `e2e`, and
`gate` all required.

## MCP Server

Syncro exposes its Gemini generation features as an MCP server, so agents can
drive narration, TTS, and captions without the UI. Every call is logged with
token counts and an estimated cost.

```sh
export GEMINI_API_KEY=your-key
npm run mcp
```

Tools: `generate_narration` (script from clip analyses), `generate_tts`
(script → WAV audio), `generate_captions` (audio → transcription with
segment timings). Point any MCP client at the stdio transport:

```json
{ "command": "npx", "args": ["tsx", "server/mcp/index.ts"], "env": { "GEMINI_API_KEY": "<key>" } }
```

Tools also cover the saved-projects API (`list_projects`, `get_project`,
`create_project`, `update_project`, `delete_project`) and media
(`upload_media`, `attach_media`, plus the read-only `get_timeline`).

Or run the server over **streamable HTTP** for network clients:

```bash
npm run mcp:http               # listens on http://127.0.0.1:3010/mcp
npm run mcp:http -- --port=4000   # or set SYNCRO_MCP_PORT=4000
```

The HTTP server binds loopback with DNS rebinding protection enabled and keeps
stateful sessions (`POST`/`GET`/`DELETE` on `/mcp`). Point any MCP client at
`http://127.0.0.1:<port>/mcp`.
