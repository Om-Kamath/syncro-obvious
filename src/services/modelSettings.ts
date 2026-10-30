import { FEATURE_MODELS, type ModelSettings, type ModelTier } from './models';

// Persistence for model-selection settings. Pure resolution logic lives in
// models.ts; this module is the localStorage adapter, in the apiKey.ts pattern.

const STORAGE_KEY = 'syncro_model_settings';

const TIERS: readonly ModelTier[] = ['flashLite', 'flash', 'pro'];

function isTier(value: unknown): value is ModelTier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}

/**
 * Narrows untrusted parsed JSON to ModelSettings, dropping unknown tiers and
 * unknown operations instead of passing them through to the resolver.
 */
export function validateModelSettings(value: unknown): ModelSettings {
  if (typeof value !== 'object' || value === null) return {};
  const { defaultTier, overrides } = value as { defaultTier?: unknown; overrides?: unknown };
  const result: ModelSettings = {};
  if (isTier(defaultTier)) result.defaultTier = defaultTier;
  if (typeof overrides === 'object' && overrides !== null) {
    const entries = Object.entries(overrides as Record<string, unknown>)
      .filter(([key, tier]) => key in FEATURE_MODELS && key !== 'tts' && isTier(tier));
    if (entries.length > 0) {
      result.overrides = Object.fromEntries(
        entries.map(([key, tier]) => [key, tier as ModelTier])
      ) as ModelSettings['overrides'];
    }
  }
  return result;
}

export function getModelSettings(): ModelSettings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return validateModelSettings(JSON.parse(raw));
  } catch (err) {
    // A corrupt blob must not take down every AI call — discard it and fall
    // back to the registry baseline. Warned, not swallowed.
    console.warn('[modelSettings] discarding corrupt stored settings', err);
    localStorage.removeItem(STORAGE_KEY);
    return {};
  }
}

export function setModelSettings(settings: ModelSettings): void {
  const hasOverrides = !!settings.overrides && Object.keys(settings.overrides).length > 0;
  if (!settings.defaultTier && !hasOverrides) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }
}
