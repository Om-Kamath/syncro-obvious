# Syncro Architecture

This document describes Syncro as it actually is on `main` (verified against commit `baa55e2`, 2026-10-30), not as it is planned to be. File and line references are accurate as of that commit and will drift; treat them as evidence, not contract.

**The short version:** Syncro is a browser-only, single-page video editor. One React component (`src/App.tsx`) owns all editor state. There is no router, no state library, no backend, and no persistence — the only network dependency is the Gemini API, called with a key the user pastes into their browser. Playback is a UI clock, not a media pipeline. Export re-records a canvas in real time with `MediaRecorder`. What you can save today is the Gemini API key; everything else dies on reload.

```
┌───────────────────────────────────────────────┐
│ Browser (React 19 + Vite SPA)                 │
│                                               │
│  App.tsx — all editor state (useState)        │
│    ├─ Timeline.tsx     (playback + editing)   │
│    ├─ PostProcessingPanel (export drawer)     │
│    └─ services/  →  Gemini API (user's key)   │
└───────────────────────────────────────────────┘
          │  HTTPS, @google/genai SDK
          ▼
   Google Gemini API        ← the only server Syncro talks to
```

## Module map

| Path | Lines | Responsibility |
| --- | --- | --- |
| `src/App.tsx` | 858 | Single state container; uploads, alignment orchestration, preview, `CaptionOverlay`, modals |
| `src/components/Timeline.tsx` | 703 | Playback clock, waveform, drag/trim/track editing, zoom, AI-align entry point |
| `src/components/PostProcessingPanel.tsx` | 1145 | Description / Captions / Thumbnails / Export tabs; canvas + `MediaRecorder` exporter |
| `src/services/gemini.ts` | 315 | TTS, narration, transcription, video analysis, alignment, segment estimation, Files API |
| `src/services/postProcessing.ts` | 124 | Description + key-moment generation (structured JSON output) |
| `src/services/models.ts` | 20 | Model-id registry — the one place model strings live |
| `src/services/logger.ts` | 48 | In-memory pub/sub API-call log (rendered by `LogPanel.tsx`) |
| `src/services/apiKey.ts` | 17 | localStorage read/write of the Gemini key |
| `src/utils/chainClips.ts` | 13 | Pure timeline layout: cumulative `startTime` |
| `src/utils/captionUtils.ts` | 54 | SRT/VTT generation + file downloads |
| `src/utils/exportPresets.ts` | 111 | 16:9 / 9:16 / 1:1 canvas geometry (letterbox vs. smart crop) |
| `src/utils/exportUtils.ts` | 160 | Frame capture, quote overlay, downloads, clip-at-time lookup |
| `src/utils/lruCache.ts` | 41 | Bounded LRU cache (backs the Files-API URI cache) |
| `src/utils/timelineZoom.ts` | 35 | Pure zoom math (clamped px/s, fit-to-window) |
| `src/components/ClipEditor.tsx` | 227 | Per-clip trim + text-overlay modal |
| `src/components/VoiceoverEditor.tsx` | 158 | Voiceover trim modal |
| `src/components/FileUploader.tsx` | 62 | react-dropzone wrapper |
| `src/components/LogPanel.tsx` | 105 | Subscribes to the logger and renders entries |
| `src/components/ErrorBoundary.tsx` | 52 | Last-resort render boundary around the app shell |

## State flow

All editor state lives in `App` as `useState` hooks (`src/App.tsx:263-279`): `videoClips: VideoClip[]`, `voiceover: Voiceover | null`, `currentTime`, `activeVideoId`, `captionsEnabled`, `captionStyle`, and modal/onboarding flags. Child components receive slices plus setters; there is no reducer, context, or store. `main.tsx` wraps `App` in `StrictMode` and an `ErrorBoundary` (`src/main.tsx:7-12`).

The timeline is **derived, not stored**. Array order is the source of truth; `chainClips` (`src/utils/chainClips.ts:5`) recomputes each clip's `startTime` as the cumulative sum of the preceding effective durations (`trimmedDuration ?? duration`). Operations that move clips — AI alignment, alternative-swap (`src/App.tsx:459`), drag in the Timeline — reorder the array and re-run `chainClips`. Multi-track adds a `track` layer per clip; overlaps within a track are resolved by truncating the earlier clip's `trimmedDuration` at drag end (`resolveOverlaps`, `src/components/Timeline.tsx:210`), not by storing absolute positions.

Media is held as in-memory object URLs. Uploads create `URL.createObjectURL(file)` per clip (`src/App.tsx:329-338`); removing a clip or replacing the voiceover revokes the URL (`src/App.tsx:437-457`), and the Files-API URI cache is capped at 20 entries via `LruCache` (`src/services/gemini.ts:17-18`). Blobs are never persisted anywhere.

**Playback is a UI clock.** While playing, a `requestAnimationFrame` loop advances `currentTime` by wall-clock delta (`src/components/Timeline.tsx:160-192`); it also seeks the WaveSurfer waveform to the matching trim-adjusted position. A sync effect in `App` finds the clip covering `currentTime` and seeks its `<video>` element when drift exceeds 0.1s (`src/App.tsx:295-327`). There is no master media pipeline — preview transitions (fade/wipe) are CSS opacity/clip-path transitions on stacked `<video>` elements (`src/App.tsx:654-690`), and dissolve renders identically to fade. Preview video elements are muted; the only preview audio is the voiceover, played through the WaveSurfer element and kept in sync by the same clock.

## Gemini integration

Two identical local `getAI()` factories construct clients from the localStorage key (`src/services/gemini.ts:7`, `src/services/postProcessing.ts:5`) — a known duplication, with a shared-client refactor in flight. Model ids come from the registry `MODELS` (`src/services/models.ts:13`): `tts = gemini-3.8-flash-tts`, `flashLite = gemini-3.5-flash-lite`, `flash = gemini-3.8-flash`. The registry exists because the 2.5-series ids and the `gemini-3-flash-preview` id broke for new API keys (migration in PR #9); it is the only place model strings should appear.

Call sites — seven `generateContent` calls plus the Files API:

| Function | Model | Purpose | Logged? |
| --- | --- | --- | --- |
| `generateAudioFromScript` (`gemini.ts:97`) | `MODELS.tts` | TTS; response is WAV or raw PCM, normalized by `inlineAudioToWavBytes` | yes |
| `generateNarrationFromVideos` (`gemini.ts:127`) | `MODELS.flashLite` | Script from clip analyses, then TTS | yes |
| `analyzeVoiceover` (`gemini.ts:178`) | `MODELS.flashLite` | Transcription of uploaded audio; **timestamps deliberately not requested** — segments estimated locally | yes |
| `analyzeVideo` (`gemini.ts:215`) | `MODELS.flashLite` | Per-clip content description | yes |
| `suggestAlignment` (`gemini.ts:245`) | `MODELS.flashLite` | Clip ordering + per-position alternatives (JSON schema) | yes |
| `generateDescription` (`postProcessing.ts:26`) | `MODELS.flash` | Summary + chapters + hashtags (JSON schema) | **no** |
| `identifyKeyMoments` (`postProcessing.ts:81`) | `MODELS.flash` | Thumbnail moments (JSON schema) | **no** |
| `getFileUri` (`gemini.ts:21`) | Files API | Upload once per `name::size`, LRU-bounded, poll until ACTIVE | upload only |

The logging gap is real: `postProcessing.ts` never imports the logger, so its calls are invisible in the LogPanel, and token/cost accounting does not exist anywhere yet (`LogEntry` carries `fn/model/detail/durationMs/error` only, `src/services/logger.ts:3-12`). Error handling differs by module: `gemini.ts` logs errors through `finishLog` and rethrows; `postProcessing.ts` raises on empty or malformed model output via `parseModelJson` (`postProcessing.ts:15`) so failures surface instead of reading as "no data."

**AI Auto-Align orchestration** (`src/App.tsx:380-435`) is the pipeline that unlocks post-processing: transcribe the uploaded voiceover if needed, back-fill segments with `estimateSegments` (`gemini.ts:156` — sentence split, duration distributed proportionally by character count), analyze any un-analyzed clips, call `suggestAlignment`, reorder clips, and re-chain. All caption timings in the app are estimates derived from this path; the transcription prompt explicitly suppresses timestamps to keep the call cheap (`gemini.ts:191-196`).

## Captions

Segment timing: estimated, everywhere. `estimateSegments` is the only timing source and has no word-level data.

Preview (`CaptionOverlay`, `src/App.tsx:44-103`) supports three modes: `lower-third` (whole-segment bar), `speaker-labeled` (hard-coded "Speaker:" prefix), and `word-highlight`, which fakes word timing by even-splitting the segment across its words (`src/App.tsx:60-64`). The hard-highlight color is the `--color-caption-highlight` theme token (`src/index.css`) rather than an inline literal, so themes can restyle it.

Export burn-in (`drawCaptionOnCanvas`, `src/components/PostProcessingPanel.tsx:974-1007`) is **not** at parity with preview: it renders the whole segment text in a single box using `captionStyle` color/position, ignores the caption mode entirely (no word-highlight), and scales font size from canvas width. Choosing "Word Highlight" in preview then exporting yields a plain box in the video. This is a known gap, not a bug someone has claimed.

SRT/VTT files (`src/utils/captionUtils.ts:22-35`) are generated from the same estimated segments, so downloaded captions match what preview shows but are only as accurate as character-count proportioning.

## Export pipeline

`ExportTab.handleExportVideo` (`src/components/PostProcessingPanel.tsx:655-760`) records in real time — a 60s project takes 60s to export:

1. Create an offscreen canvas at the preset size. Presets (`src/utils/exportPresets.ts:27`): 16:9 → 1280×720 with letterbox (`contain`); 9:16 → 1080×1920 and 1:1 → 1080×1080 with smart crop (`cover`, center-crop). Geometry math is pure and unit-tested (`computeDrawGeometry`, `exportPresets.ts:104`).
2. Pre-load one muted `<video>` per clip; a failed load is skipped rather than failing the export.
3. Build the audio graph from the **voiceover only**: `AudioContext.createMediaElementSource(voiceover.url)` → both the recorder destination and the speakers. Clip audio tracks are never heard in an export.
4. Combine canvas stream (30 fps) + audio destination into a `MediaRecorder`; `pickMimeType` (`PostProcessingPanel.tsx:959`) prefers MP4/H.264, falls back to WebM/VP9, and output is always named `syncvoice-export.<ext>` regardless of project name.
5. Draw loop (`PostProcessingPanel.tsx:722`): wall-clock elapsed → find the active clip via `getClipAtTime` (`exportUtils.ts:139`), seek if drifted > 0.2s, draw with preset geometry, burn in the current caption segment, repeat until the voiceover's trimmed duration elapses.

Two quirks worth knowing: timeline gaps do not pause the export — `getClipAtTime` wraps time modulo total clip duration, so a gap plays clips from the start again (`exportUtils.ts:150-158`) — and the export duration is anchored to the voiceover's trimmed length, not to the clips' total. There is a progress bar and a cancel path (`stopRef`), but no frame-accurate rendering; audio is the timing master.

## Post-processing (publish assets)

The `PostProcessingPanel` drawer unlocks its first three tabs only after Auto-Align has produced a transcription and segments. DescriptionTab generates a summary, 3–8 chapter timestamps, and 8–12 hashtags, formatted for copy-paste. ThumbnailsTab asks for 4–5 key moments, captures a frame per moment from the covering clip (`captureVideoFrame`, `exportUtils.ts:4`), overlays the quote (`addQuoteOverlay`, `exportUtils.ts:45`), and offers JPEG downloads. "Publishing" means copy buttons and downloads — there is no upload path to YouTube or any platform, and no OAuth anywhere in the codebase.

## Persistence and privacy

The complete persistence story: `localStorage["syncro_gemini_api_key"]` (`src/services/apiKey.ts:1`). Projects, clips, transcripts, caption styles — all `useState`, all lost on reload. Object URLs die with the page session. There is no `.env` usage at runtime; the dead `process.env.GEMINI_API_KEY` define and the `dotenv`/`tsx` dev deps were removed (PR #6). The API key never leaves the browser except inside Gemini API calls.

## Not yet implemented

Stated plainly, because plans often get mistaken for architecture: **Syncro has no server, no database, no saved projects, and no MCP/agent interface.** `express` and `better-sqlite3` sit unused in `package.json` (zero imports in `src/` or `tests/` — grep-verified at `baa55e2`), reserved for the campaign's server-backed saved-projects and MCP workstreams (spec: *Syncro PR Campaign Spec — Ship the Competitive Gaps*). When those merge, this document gains a server and MCP section describing the real implementation; until then, any multi-device, agent-driven, or reload-surviving behavior described anywhere else is fiction.

## Testing and CI

- **Unit:** Vitest, node environment by default with per-file jsdom overrides (`vitest.config.ts`). Coverage: segment estimation, chaining, caption/SRT/VTT generation, export preset geometry, LRU eviction, timeline zoom math, model-registry/prompt shapes, `parseModelJson` failure modes, and the error boundary.
- **E2E:** Playwright chromium smoke suite (`tests/e2e/app.spec.ts`) against the dev server on :3000 — app boot, forced API-key modal, onboarding skip, export-panel tabs. `npm run test:e2e`; **not wired into CI**.
- **CI:** `.github/workflows/ci.yml` runs on every PR and push to `main`: `npm ci` → `npm run lint` (tsc `--noEmit` + ESLint flat config) → `npm test` → `npm run build`, with concurrency cancellation. Merging is gated on this workflow.
- **TypeScript:** `tsconfig.json` is not strict yet; the strictness flag is a planned campaign PR, so the compiler still accepts some null-unsafety.

## Known sharp edges

Grounded observations a contributor will hit, kept here so nobody rediscovers them the hard way:

- The `getAI()` factory is duplicated between `gemini.ts` and `postProcessing.ts` (shared client in flight).
- `postProcessing` calls bypass the logger; LogPanel under-reports Gemini traffic.
- Exported video ignores caption modes beyond color/position, and carries voiceover audio only.
- Export wraps timeline gaps by looping clips; there is no gap or hold frame.
- Everything is re-derivable from `App.tsx` state, but nothing serializes it — reload = lost project.
- Legacy names from the AI Studio template origin: `package.json` name is `react-example`, exports are named `syncvoice-export.*`.
