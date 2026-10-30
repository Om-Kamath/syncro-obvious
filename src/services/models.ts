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
  /**
   * Flagship reasoning model — the "Pro" tier. There is no "gemini-3.8-pro":
   * the Pro branding ended with 2.5 (access-limited for new keys), and the
   * flagship line is Gemini 4 Argon, stable GA since October 2026
   * (ai.google.dev/gemini-api/docs/models/gemini-4-argon, checked 2026-10-30).
   * Text output only — no audio generation, so TTS stays pinned to MODELS.tts.
   */
  pro: 'gemini-4-argon',
} as const;

export type ModelKey = keyof typeof MODELS;
export type ModelId = (typeof MODELS)[ModelKey];

/**
 * Per-feature model selection — the single mapping of app feature → registry
 * key. Call sites resolve their model via `modelFor(<feature>)` (baseline) or
 * `resolveOperationModel(settings, <feature>)` (user-tunable) and never
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

// -------------------------------------------------------------------
// Model selection — capability tiers over the registry
// A tier never hard-codes an id; it always resolves through MODELS.
// -------------------------------------------------------------------

/** User-selectable capability tiers: every registry entry except the TTS audio model. */
export type ModelTier = Exclude<ModelKey, 'tts'>;

export const TIER_MODELS: Record<ModelTier, ModelId> = {
  flashLite: MODELS.flashLite,
  flash: MODELS.flash,
  pro: MODELS.pro,
};

/** The text operations a user can retune — every registry feature except TTS (pinned to its audio model). */
export type TextFeatureKey = Exclude<FeatureKey, 'tts'>;

/** Model-selection settings: an optional default tier plus per-op overrides. */
export interface ModelSettings {
  /** Applies to every operation without its own override; absent = registry baseline. */
  defaultTier?: ModelTier;
  /** Wins over defaultTier for that one operation. */
  overrides?: Partial<Record<TextFeatureKey, ModelTier>>;
}

/**
 * Effective model for one operation: the per-op override wins, then the
 * settings default, then the feature's registry baseline (`modelFor`).
 */
export function resolveOperationModel(settings: ModelSettings, operation: TextFeatureKey): ModelId {
  const override = settings.overrides?.[operation];
  if (override) return TIER_MODELS[override];
  if (settings.defaultTier) return TIER_MODELS[settings.defaultTier];
  return modelFor(operation);
}
