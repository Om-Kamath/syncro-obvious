import { describe, it, expect } from 'vitest';
import {
  estimateCost,
  estimateCostFromInput,
  getPricing,
  TTS_TOKENS_PER_SEC,
  TTS_CHARS_PER_SEC,
} from './costModel';
import { MODELS } from './models';

const MTOK = 1_000_000;

describe('estimateCost (post-run, from real token counts)', () => {
  // (label, model, inputTokens, outputTokens, expected USD)
  const cases: Array<[string, string, number, number, number]> = [
    ['text-only TTS input', MODELS.tts, MTOK, 0, 0.5],
    ['audio-only TTS output', MODELS.tts, 0, MTOK, 9],
    ['flash-lite 1M/1M', MODELS.flashLite, MTOK, MTOK, 2.8],
    ['flash 1M/1M', MODELS.flash, MTOK, MTOK, 4.5],
    ['flash small call', MODELS.flash, 4000, 2000, 0.0105],
    ['flash-lite input only', MODELS.flashLite, 1500, 0, 0.00045],
    ['TTS small call', MODELS.tts, 35, 250, 0.0022675],
  ];

  it.each(cases)('%s: costs $%s', (_label, model, inputTokens, outputTokens, expected) => {
    expect(estimateCost(model, { inputTokens, outputTokens })).toBeCloseTo(expected, 10);
  });

  it('charges nothing for zero usage', () => {
    expect(estimateCost(MODELS.flash, { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it('scales linearly with token count', () => {
    const one = estimateCost(MODELS.flash, { inputTokens: 100, outputTokens: 100 });
    const five = estimateCost(MODELS.flash, { inputTokens: 500, outputTokens: 500 });
    expect(five).toBeCloseTo(one * 5, 12);
  });
});

describe('estimateCostFromInput (pre-run, from input size)', () => {
  // (label, model, input, expected inputTokens, expected outputTokens)
  const tokenCases: Array<[string, string, { chars?: number; durationSec?: number }, number, number]> = [
    ['flash chars only', MODELS.flash, { chars: 4000 }, 1000, 0],
    ['flash chars + media', MODELS.flash, { chars: 4000, durationSec: 60 }, 2500, 0],
    ['flash-lite media only', MODELS.flashLite, { durationSec: 60 }, 1500, 0],
    ['flash single char rounds up to a token', MODELS.flash, { chars: 1 }, 1, 0],
    ['TTS derives audio length from script', MODELS.tts, { chars: 140 }, 35, 250],
    ['TTS prefers given duration over heuristic', MODELS.tts, { chars: 140, durationSec: 20 }, 35, 500],
    ['TTS duration without script', MODELS.tts, { durationSec: 10 }, 0, 250],
    ['empty input estimates nothing', MODELS.flash, {}, 0, 0],
  ];

  it.each(tokenCases)('%s', (_label, model, input, inputTokens, outputTokens) => {
    const est = estimateCostFromInput(model, input);
    expect(est.inputTokens).toBe(inputTokens);
    expect(est.outputTokens).toBe(outputTokens);
  });

  it('text-model pre-run estimates are an input-side floor (outputTokens 0)', () => {
    const est = estimateCostFromInput(MODELS.flashLite, { chars: 4000 });
    expect(est.costUsd).toBeCloseTo(est.inputTokens * 0.3 / MTOK, 12);
  });

  it('a 140-char script estimates to Google\'s published $0.00225 per 10s of TTS audio', () => {
    // Cross-check against the pricing page's per-10s TTS figure:
    // 10s × 25 tokens/s × $9/MTok = $0.00225 (checked 2026-10-30).
    const est = estimateCostFromInput(MODELS.tts, { chars: 10 * TTS_CHARS_PER_SEC });
    expect(est.outputTokens).toBe(10 * TTS_TOKENS_PER_SEC);
    expect(est.costUsd).toBeCloseTo(0.00225 + (35 * 0.5) / MTOK, 9);
  });

  it('prices the token estimate with the same math as estimateCost', () => {
    const est = estimateCostFromInput(MODELS.flashLite, { chars: 4000, durationSec: 60 });
    expect(est.costUsd).toBe(
      estimateCost(MODELS.flashLite, { inputTokens: est.inputTokens, outputTokens: est.outputTokens })
    );
  });
});

describe('getPricing', () => {
  it('every model in the registry has pricing', () => {
    for (const model of Object.values(MODELS)) {
      expect(() => getPricing(model)).not.toThrow();
    }
  });

  it('throws a helpful error for unknown models instead of silently pricing $0', () => {
    expect(() => getPricing('gpt-4o')).toThrow(/No pricing registered for model "gpt-4o"/);
    expect(() => estimateCost('gpt-4o', { inputTokens: 1, outputTokens: 1 })).toThrow(/gpt-4o/);
  });
});
