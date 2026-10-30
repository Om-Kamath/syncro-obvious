import { describe, it, expect } from 'vitest';
import { aggregateUsage } from './usageAggregation';
import type { UsageEntry } from './usageAggregation';
import { MODELS } from '../services/models';

const FLASHLITE = MODELS.flashLite; // $0.30 in / $2.50 out per 1M
const TTS = MODELS.tts;             // $0.50 in / $9.00 out per 1M

describe('aggregateUsage', () => {
  it('returns a zeroed aggregate for no entries', () => {
    expect(aggregateUsage([])).toEqual({
      ops: [],
      totals: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0, unpricedCalls: 0 },
    });
  });

  it('groups entries by operation and sums tokens across calls', () => {
    const entries: UsageEntry[] = [
      { fn: 'Analyze Video', model: FLASHLITE, inputTokens: 1000, outputTokens: 100 },
      { fn: 'Analyze Video', model: FLASHLITE, inputTokens: 500, outputTokens: 50 },
      { fn: 'TTS Generate', model: TTS, inputTokens: 200, outputTokens: 5000 },
    ];

    const { ops } = aggregateUsage(entries);
    expect(ops).toHaveLength(2);

    const analyze = ops.find(op => op.fn === 'Analyze Video')!;
    expect(analyze.calls).toBe(2);
    expect(analyze.inputTokens).toBe(1500);
    expect(analyze.outputTokens).toBe(150);
    expect(analyze.totalTokens).toBe(1650);
    expect(analyze.models).toEqual([FLASHLITE]);

    const tts = ops.find(op => op.fn === 'TTS Generate')!;
    expect(tts.calls).toBe(1);
    expect(tts.totalTokens).toBe(5200);
  });

  it('applies the cost model per entry (tokens × price)', () => {
    const entries: UsageEntry[] = [
      // (1500 × $0.30 + 150 × $2.50) / 1M = 0.000825
      { fn: 'Analyze Video', model: FLASHLITE, inputTokens: 1000, outputTokens: 100 },
      { fn: 'Analyze Video', model: FLASHLITE, inputTokens: 500, outputTokens: 50 },
      // (200 × $0.50 + 5000 × $9.00) / 1M = 0.0451
      { fn: 'TTS Generate', model: TTS, inputTokens: 200, outputTokens: 5000 },
    ];

    const { ops } = aggregateUsage(entries);
    expect(ops.find(op => op.fn === 'Analyze Video')!.estimatedCost).toBeCloseTo(0.000825, 12);
    expect(ops.find(op => op.fn === 'TTS Generate')!.estimatedCost).toBeCloseTo(0.0451, 12);
  });

  it('sums per-op costs into session totals across all ops', () => {
    const entries: UsageEntry[] = [
      { fn: 'Analyze Video', model: FLASHLITE, inputTokens: 1000, outputTokens: 100 },
      { fn: 'Analyze Video', model: FLASHLITE, inputTokens: 500, outputTokens: 50 },
      { fn: 'TTS Generate', model: TTS, inputTokens: 200, outputTokens: 5000 },
    ];

    const { totals } = aggregateUsage(entries);
    expect(totals.calls).toBe(3);
    expect(totals.inputTokens).toBe(1700);
    expect(totals.outputTokens).toBe(5150);
    expect(totals.totalTokens).toBe(6850);
    expect(totals.estimatedCost).toBeCloseTo(0.045925, 12);
    expect(totals.unpricedCalls).toBe(0);
  });

  it('counts entries without token data as calls but zero tokens/cost', () => {
    const entries: UsageEntry[] = [
      { fn: 'Analyze Voiceover', model: FLASHLITE }, // pending or pre-usage-capture entry
    ];

    const { ops, totals } = aggregateUsage(entries);
    expect(ops[0].calls).toBe(1);
    expect(ops[0].inputTokens).toBe(0);
    expect(ops[0].outputTokens).toBe(0);
    expect(ops[0].estimatedCost).toBe(0);
    expect(ops[0].unpricedCalls).toBe(0); // priced model, zero measured tokens
    expect(totals.calls).toBe(1);
    expect(totals.estimatedCost).toBe(0);
  });

  it('marks calls on unpriced models instead of guessing $0', () => {
    const entries: UsageEntry[] = [
      { fn: 'Legacy Op', model: 'mystery-model', inputTokens: 999, outputTokens: 999 },
      { fn: 'Analyze Video', model: FLASHLITE, inputTokens: 1000, outputTokens: 100 },
    ];

    const { ops, totals } = aggregateUsage(entries);
    const legacy = ops.find(op => op.fn === 'Legacy Op')!;
    expect(legacy.estimatedCost).toBe(0);
    expect(legacy.unpricedCalls).toBe(1);
    // Priced spend still counts while unpriced calls are flagged separately.
    expect(totals.estimatedCost).toBeCloseTo(0.00055, 12); // (1000×0.30 + 100×2.50)/1M
    expect(totals.unpricedCalls).toBe(1);
  });

  it('tracks distinct models per op in first-seen order', () => {
    const entries: UsageEntry[] = [
      { fn: 'Analyze Video', model: FLASHLITE, inputTokens: 100, outputTokens: 0 },
      { fn: 'Analyze Video', model: MODELS.flash, inputTokens: 100, outputTokens: 0 },
      { fn: 'Analyze Video', model: FLASHLITE, inputTokens: 100, outputTokens: 0 },
    ];

    const { ops } = aggregateUsage(entries);
    expect(ops[0].models).toEqual([FLASHLITE, MODELS.flash]);
    expect(ops[0].calls).toBe(3);
  });

  it('sorts ops by estimated cost desc, then tokens desc, then name', () => {
    const entries: UsageEntry[] = [
      { fn: 'Analyze Voiceover', model: FLASHLITE }, // $0, 0 tokens
      { fn: 'Legacy Op', model: 'mystery-model', inputTokens: 999, outputTokens: 999 }, // $0, 1998 tokens
      { fn: 'Analyze Video', model: FLASHLITE, inputTokens: 1000, outputTokens: 100 }, // $0.00055
      { fn: 'TTS Generate', model: TTS, inputTokens: 200, outputTokens: 5000 }, // $0.0451
    ];

    const { ops } = aggregateUsage(entries);
    expect(ops.map(op => op.fn)).toEqual(['TTS Generate', 'Analyze Video', 'Legacy Op', 'Analyze Voiceover']);
  });
});
