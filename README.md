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
