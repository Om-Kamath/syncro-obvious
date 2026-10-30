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
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm test` | Run Vitest tests |
| `npm run lint` | Type-check (`tsc --noEmit`) + ESLint |
| `npm run clean` | Remove `dist/` |

## Agents (MCP)

Syncro ships an MCP (Model Context Protocol) server so AI agents can list saved projects, inspect project state and timelines, and trigger exports without the UI. See [MCP.md](MCP.md) for the tool reference, launch instructions, and ready-made Claude Desktop / generic agent configs.
