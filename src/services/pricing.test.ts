import { describe, it, expect } from 'vitest';
import { MODELS } from './models';
import { MODEL_PRICING, estimateCost } from './pricing';

describe('MODEL_PRICING', () => {
  it('covers every model in the central registry', () => {
    for (const model of Object.values(MODELS)) {
      expect(MODEL_PRICING[model], `missing pricing for ${model}`).toBeDefined();
    }
  });

  it('matches the published per-1M-token prices', () => {
    expect(MODEL_PRICING[MODELS.flashLite]).toEqual({ input: 0.3, output: 2.5 });
    expect(MODEL_PRICING[MODELS.tts]).toEqual({ input: 0.5, output: 9.0 });
    expect(MODEL_PRICING[MODELS.flash]).toEqual({ input: 0.75, output: 3.75 });
  });
});

describe('estimateCost', () => {
  it('prices 1M input tokens only', () => {
    expect(estimateCost(MODELS.flashLite, 1_000_000, 0)).toBeCloseTo(0.3, 10);
  });

  it('prices 1M output tokens only', () => {
    expect(estimateCost(MODELS.flashLite, 0, 1_000_000)).toBeCloseTo(2.5, 10);
  });

  it('scales linearly with tokens (fractional millions)', () => {
    // 1.5M in + 0.5M out at $0.30/$2.50 per 1M → 0.45 + 1.25
    expect(estimateCost(MODELS.flashLite, 1_500_000, 500_000)).toBeCloseTo(1.7, 10);
  });

  it('prices TTS audio output at the audio-token rate', () => {
    // 0.2M text in + 0.4M audio out at $0.50/$9.00 per 1M → 0.10 + 3.60
    expect(estimateCost(MODELS.tts, 200_000, 400_000)).toBeCloseTo(3.7, 10);
  });

  it('returns 0 for zero tokens on a priced model', () => {
    expect(estimateCost(MODELS.flash, 0, 0)).toBe(0);
  });

  it('returns null for models without a pricing entry', () => {
    expect(estimateCost('mystery-model', 100, 100)).toBeNull();
  });
});
