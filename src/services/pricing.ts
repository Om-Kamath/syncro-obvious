import { MODELS } from './models';

/**
 * Cost model for the session usage dashboard: USD per 1M tokens, split by
 * direction. Figures retrieved 2026-10-30 from the official Gemini pricing
 * pages (ai.google.dev and cloud.google.com docs):
 * The TTS prices cover intro pricing through 2026-12-31 and double from
 * 2027-01-01. TTS output is audio tokens (~25 tokens/second of audio, per
 * Google Cloud), so the same per-token math covers the whole registry.
 */
export interface ModelPrice {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  [MODELS.tts]: { input: 0.5, output: 9.0 },
  [MODELS.flashLite]: { input: 0.3, output: 2.5 },
  [MODELS.flash]: { input: 0.75, output: 3.75 },
};

/**
 * Estimated USD cost of one call, or null when the model has no pricing
 * entry. Callers surface null as "unpriced" rather than silently guessing $0.
 */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = MODEL_PRICING[model];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
