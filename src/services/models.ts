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

export type ModelKey = keyof typeof MODELS;
export type ModelId = (typeof MODELS)[ModelKey];

/**
 * Per-feature model selection — the single mapping of app feature → registry
 * key. Call sites resolve their model via `modelFor(<feature>)` and never
 * reference a model id (or a registry key) directly.
 */
export const FEATURE_MODELS = {
  /** TTS voiceover generation. */
  tts: 'tts',
  /** Narration script writing. */
  narration: 'flashLite',
  /** Voiceover transcription. */
  transcription: 'flashLite',
  /** Video clip content analysis. */
  videoAnalysis: 'flashLite',
  /** AI clip alignment suggestions. */
  clipAlignment: 'flashLite',
  /** Post-processing: description, chapters, hashtags. */
  description: 'flash',
  /** Post-processing: thumbnail key moments. */
  thumbnails: 'flash',
} as const satisfies Record<string, ModelKey>;

export type FeatureKey = keyof typeof FEATURE_MODELS;

/** Resolves the model id pinned for a feature. */
export function modelFor(feature: FeatureKey): ModelId {
  return MODELS[FEATURE_MODELS[feature]];
}
