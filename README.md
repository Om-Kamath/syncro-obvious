# Syncro

A narration-first video editor that runs in the browser, with an optional local server for saved projects and an MCP server so AI agents can drive it directly.

Import clips, generate a narration script and TTS voiceover with Gemini, arrange a multi-track timeline, and export finished video with word-timed captions, thumbnails, and publish-ready metadata. Your Gemini API key stays in your browser; your projects stay on your machine (or your own server).

[![CI](https://github.com/Om-Kamath/syncro-obvious/actions/workflows/ci.yml/badge.svg)](https://github.com/Om-Kamath/syncro-obvious/actions/workflows/ci.yml)

## Quick start

**Prerequisites:** Node.js 20+ (the version CI runs).

**Client only** — edit and export without the server:

```bash
npm install
npm run dev          # http://localhost:3000
```

On first launch, click the key icon in the header and paste your Gemini API key. The key is stored in your browser's local storage (`syncro_gemini_api_key`) — it never leaves your machine and no `.env` file is needed.

**Full stack** — add saved projects (reload-safe), media storage, and MCP:

```bash
npm install
npm run server:dev   # Express API + SQLite on http://localhost:3001 (watch mode)
npm run dev          # the editor, in a second terminal
```

`npm run server:start` runs the API server without watch. For Docker, one container serves the built app and the API: `docker compose up --build` (app + API on http://localhost:3001).

The SQLite database defaults to `syncro.db` (override with `SYNCRO_DB_PATH`); under Docker it lives on the `syncro-data` volume so projects survive rebuilds.

## What Syncro does

**Editing** — multi-track timeline with drag reordering, snapping, trim, ripple delete, filmstrip thumbnails, adjustable zoom, and keyboard transport shortcuts (space, J/K/L, arrows). Clips chain by array order; the timeline is derived from it, not the other way around.

**AI voiceover and analysis** — Gemini writes a narration script from your clip analyses, generates TTS audio, transcribes uploaded voiceovers, and suggests clip alignment. Auto-Align analyzes clips, orders the timeline, and back-fills caption segments.

**Captions** — preview highlighting and export burn-in follow real word timings from transcription (with a character-count fallback when the model returns none). Style presets (Minimal, Bold Pop, Karaoke, Classic), reusable templates, and SRT/VTT import and export.

**Publishing** — generated descriptions with chapters and hashtags, YouTube-format chapters as a separate download, key-moment thumbnail captures with quote overlays, and aspect presets (9:16 / 16:9 / 1:1) with letterbox or smart-crop handling in exports.

**Export** — canvas + `MediaRecorder` pipeline with quality presets (with estimated output size), background music with volume control, and WebM/MP4 with codec fallback.

**Projects** — save and reload the full editor state (clips, voiceover, caption style, ordering) through the local server, with a per-clip error banner when media can't be restored.

## Architecture

Syncro is three programs, not one: a browser SPA, an Express API with a SQLite database, and an MCP server that wraps the API for agents. The browser is the editor; the server owns persistence; MCP is a third door into the same project data.

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│ Browser client (React 19)   │  HTTPS  │ Gemini API                   │
│                             ├────────►│ TTS · transcription ·        │
│  App.tsx — editor state     │         │ analysis · structured JSON   │
│  ├─ Timeline.tsx            │         └──────────────────────────────┘
│  ├─ CaptionOverlay          │
│  ├─ PostProcessingPanel     │
│  └─ services/geminiClient ──┼── token + cost capture on every call
└──────────┬──────────────────┘
           │ REST /api (bearer token)
┌──────────▼──────────────────┐   stdio / HTTP   ┌─────────────────────────┐
│ Express server (port 3001) ◄──────────────────┤ MCP server              │
│  ├─ /api/projects CRUD      │                  │  project read + mutate  │
│  ├─ /api/media (blobs)      │                  │  media upload/attach    │
│  ├─ /healthz · /version     │                  │  generate assets        │
│  └─ better-sqlite3          │                  │  trigger exports        │
└─────────────────────────────┘                  └─────────────────────────┘
```

Details, file-by-file: **[ARCHITECTURE.md](ARCHITECTURE.md)** describes the shipped system, including playback model, export pipeline, and known sharp edges.

### Browser client

Vite + React 19 + TypeScript (strict) + Tailwind 4. One component (`src/App.tsx`) owns editor state; `src/services/` holds the Gemini integration and logger; `src/utils/` holds pure timeline, caption, and export math that the unit tests cover. Playback is a UI clock that seeks `<video>` elements and the waveform; export redraws the timeline onto a canvas in real time and records it.

### Server

Express + better-sqlite3, under `server/`:

| Path | What it does |
| --- | --- |
| `server/index.ts` | Listener: port `3001` (`PORT` to override), opens the on-disk database |
| `server/app.ts` | App factory: routes, JSON errors, 404s — tests get a fresh app per call |
| `server/db/` | SQLite connection + versioned migrations for projects and media |
| `server/projects/` | `ProjectState` validation, store, and REST router |
| `server/middleware/auth.ts` | Bearer-token auth for `/api` |

HTTP surface: `GET /healthz`, `GET /version`, and `GET|POST /api/projects` + `GET|PUT|DELETE /api/projects/:id` for full-project CRUD (clips, voiceover meta, caption style, ordering). Media is stored as blobs on disk: `POST /api/media` takes the raw request body as the blob (no multipart; an optional `?filename=` query param or `x-filename` header names it) and returns 201 with `{ id, filename, mimeType, size, createdAt }`; `GET /api/media/:id` serves the bytes with HTTP range support (206 partial responses, `Accept-Ranges: bytes`, `HEAD` supported) so `<video>` elements can seek. Out-of-range requests get 416; uploads over the size cap get 413. All errors are JSON; 4xx messages are safe to surface, 5xx details stay in the server log.

Server configuration: `SYNCRO_DB_PATH` (SQLite file, default `syncro.db`), `SYNCRO_MEDIA_DIR` (blob directory, default `data/media`), and `SYNCRO_MAX_UPLOAD_BYTES` (upload cap, default 512 MiB).

Auth is a single operator token: set `SYNCRO_API_TOKEN` on the server process and send it as `Authorization: Bearer <token>` on API calls. It fails closed — if the variable is unset or empty, every API request gets a 401, never open access. The token is read per request, so you can rotate it without restarting.

Saved projects serialize everything in the editor: clip metadata (order, tracks, trims, transitions, text overlays, analyses), voiceover transcription and segments, and caption style. Media files upload alongside the metadata and rehydrate as playable clips on load.

### MCP server

A Model Context Protocol server (`server/mcp/`) lets an agent manage Syncro's saved projects and move media without the UI. Seven tools are live today:

- **Projects** — `list_projects`, `get_project`, `create_project`, `update_project`, and `delete_project` cover the full project lifecycle against the running server.
- **Media** — `upload_media` puts a file on the server; `attach_media` adds it to a project's timeline.
- **Planned** — server-side Gemini generation and export-trigger tools are documented in [MCP.md](MCP.md) ahead of their branches landing.

The server is a thin REST client of the projects API — it holds no database of its own — and points at a running Syncro server via `SYNCRO_SERVER_URL` (default `http://localhost:3001`). Expected failures (unknown project id, API unreachable) surface as tool errors the calling agent can react to; they never crash the session. One transport today: **stdio**, launched as `npm run mcp:start`; streamable HTTP is planned.

Full tool reference, launch instructions, and copy-paste Claude Desktop / generic agent configs (in [`docs/examples/`](docs/examples/)): **[MCP.md](MCP.md)**.

## Cost model

Every Gemini call routes through one shared client module (`src/services/geminiClient.ts`), which is the single seam where logging, token capture, and cost accounting happen:

- **Per-call accounting** — each call's `usageMetadata` (input/output tokens) is captured and priced from a per-model table; the LogPanel shows every operation's cost plus a running session total.
- **Pre-run estimates** — badges next to the TTS, narration, description, and thumbnail actions show the estimated cost before the action runs, derived from input size.
- **Honest failures** — a failed call still logs its duration and tokens consumed, and distinguishes "cost nothing" from "billed".
- **Model registry** — model ids are pinned once in `src/services/models.ts`; the registry notes why each id was chosen and is kept current against Gemini deprecations.

Files API uploads are billed separately from content calls and are accounted as their own line item rather than folded into per-call costs.

## Testing and CI

| Layer | Command | What runs |
| --- | --- | --- |
| Lint | `npm run lint` | TypeScript (`tsc --noEmit`) + ESLint (typescript-eslint, react-hooks) |
| Unit | `npm test` | Vitest: timeline math, captions/SRT, export geometry, caches, model registry, server routes (supertest), MCP tools |
| E2E | `npm run test:e2e` | Playwright (Chromium): app boot, onboarding, editor and publish flows; axe-core accessibility checks |
| Build | `npm run build` | Production bundle must compile |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit+build, and e2e as four parallel jobs; the aggregate `gate` check is the one branch protection should require, so a job can never be skipped around. The unit job publishes the V8 coverage report as a build artifact, and a fresh push cancels the superseded run immediately.

## Contributing

Read **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup and conventions. The short version: conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `a11y:`, `perf:`, `ci:`), one concern per PR, tests colocated next to the code they cover, CI green before merge, and don't commit `node_modules/`, `dist/`, or stray lockfiles (`bun.lock` is not welcome here).

## Documentation map

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the system actually works: state flow, Gemini integration, captions, export pipeline, persistence, known sharp edges |
| [MCP.md](MCP.md) | Agent-facing MCP guide: tool reference, transports, launch instructions, client configs, troubleshooting |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Local setup, test organization, commit and PR conventions |
