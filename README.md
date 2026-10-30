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

## Run with Docker

One container serves both the built UI and the API: a multi-stage build compiles the web app with Vite, then runs the Express server over `dist/`.

1. Build and start:
   `docker compose up --build`
2. UI: `http://localhost:3001` — API health: `http://localhost:3001/healthz`.

`docker-compose.yml` mounts the named volume `syncro-data` at `/app/data` (`SYNCRO_DATA_DIR`), where the SQLite data for the saved-projects feature will live. Without Compose: `docker build -t syncro . && docker run -p 3001:3001 syncro`.

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
