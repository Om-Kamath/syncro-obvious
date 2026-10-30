/**
 * Central Gemini model registry — the single place where model ids are pinned.
 *
 * Kept current against ai.google.dev/gemini-api/docs/deprecations (checked 2026-10-30):
 * - `gemini-2.5-flash-preview-tts` shuts down 2026-11-17; recommended replacement
 *   is `gemini-3.8-flash-tts` (or `gemini-3.8-flash-lite-tts`). Verified working
 *   via `models.generateContent` with responseModalities ['AUDIO'] on SDK 1.43.
 * - 2.5-series models are access-limited to keys that actively used them
 *   ("for any new projects, use our latest models: 3.5 Flash-Lite or 3.8 Flash"),
 *   so new API keys get 404/permission errors on `gemini-2.5-flash-lite`.
 * - `gemini-3-flash-preview` is a preview model; latest GA Flash is `gemini-3.8-flash`.
 */
export const MODELS = {
  /** Text-to-speech (single-speaker narration). Returns audio/wav on unary requests. */
  tts: 'gemini-3.8-flash-tts',
  /** Fast, cheap text model for narration scripts, transcription, analysis, alignment. */
  flashLite: 'gemini-3.5-flash-lite',
  /** Higher-capability text model for structured output (descriptions, key moments). */
  flash: 'gemini-3.8-flash',
} as const;
