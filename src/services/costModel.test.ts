import { describe, it, expect } from 'vitest';
import { estimateCostUsd, formatUsd, summarizeCosts } from './costModel';

describe('estimateCostUsd', () => {
  it('prices input and output tokens from the per-model table', () => {
    // 1,000 input @ $0.50/1M + 500 output @ $10.00/1M (TTS)
    expect(estimateCostUsd('gemini-3.8-flash-tts', 1000, 500)).toBeCloseTo(0.0055, 10);
  });

  it('uses each model’s own rates', () => {
    // 2,000 input @ $0.10/1M + 100 output @ $0.40/1M (flash-lite)
    expect(estimateCostUsd('gemini-3.5-flash-lite', 2000, 100)).toBeCloseTo(0.00024, 10);
    // 2,000 input @ $0.30/1M + 100 output @ $2.50/1M (flash)
    expect(estimateCostUsd('gemini-3.8-flash', 2000, 100)).toBeCloseTo(0.00085, 10);
  });

  it('handles one-sided usage', () => {
    expect(estimateCostUsd('gemini-3.8-flash', 1000, undefined)).toBeCloseTo(0.0003, 10);
    expect(estimateCostUsd('gemini-3.8-flash', undefined, 100)).toBeCloseTo(0.00025, 10);
  });

  it('returns undefined for unknown models instead of guessing a rate', () => {
    expect(estimateCostUsd('not-a-real-model', 100, 100)).toBeUndefined();
  });

  it('returns undefined when no token counts are known', () => {
    expect(estimateCostUsd('gemini-3.8-flash', undefined, undefined)).toBeUndefined();
  });

  it('prices zero-token calls at zero', () => {
    expect(estimateCostUsd('gemini-3.8-flash', 0, 0)).toBe(0);
  });
});

describe('formatUsd', () => {
  it('shows four decimals for regular amounts', () => {
    expect(formatUsd(0.0055)).toBe('$0.0055');
    expect(formatUsd(0)).toBe('$0.0000');
  });

  it('flags sub-precision amounts instead of rounding to zero', () => {
    expect(formatUsd(0.00005)).toBe('<$0.0001');
  });
});

describe('summarizeCosts', () => {
  it('sums tokens and cost across priced entries only', () => {
    const summary = summarizeCosts([
      { inputTokens: 1000, outputTokens: 500, estimatedCostUsd: 0.0055 },
      { estimatedCostUsd: undefined }, // pending — no usage yet
      { inputTokens: 2000, outputTokens: 100, estimatedCostUsd: 0.00024 },
    ]);
    expect(summary.totalTokensIn).toBe(3000);
    expect(summary.totalTokensOut).toBe(600);
    expect(summary.totalCostUsd).toBeCloseTo(0.00574, 10);
    expect(summary.pricedCalls).toBe(2);
  });

  it('treats missing token counts on priced entries as zero', () => {
    const summary = summarizeCosts([{ estimatedCostUsd: 0.01 }]);
    expect(summary.totalTokensIn).toBe(0);
    expect(summary.totalTokensOut).toBe(0);
    expect(summary.totalCostUsd).toBeCloseTo(0.01, 10);
    expect(summary.pricedCalls).toBe(1);
  });

  it('returns zeros for an empty session', () => {
    expect(summarizeCosts([])).toEqual({ totalTokensIn: 0, totalTokensOut: 0, totalCostUsd: 0, pricedCalls: 0 });
  });
});
