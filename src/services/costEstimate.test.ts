import { describe, it, expect } from 'vitest';
import {
  AUDIO_TOKENS_PER_SECOND,
  FALLBACK_PRICING,
  VIDEO_TOKENS_PER_SECOND,
  estimateAlignmentFlowCost,
  estimateAudioTokens,
  estimateDescriptionCost,
  estimateFlowCost,
  estimateKeyMomentsCost,
  estimateNarrationFlowCost,
  estimatePreRunCost,
  estimateTextTokens,
  estimateTtsCost,
  estimateTranscriptionCost,
  estimateVideoAnalysisCost,
  estimateVideoTokens,
  formatEstimatedCost,
} from './costEstimate';
import { MODELS } from './models';

const M_TOK = 1_000_000;

describe('token estimation from input size', () => {
  it.each([
    [0, 0],
    [-5, 0],
    [4, 1],
    [5, 2],
    [1000, 250],
  ])('estimateTextTokens(%i) → %i', (chars, expected) => {
    expect(estimateTextTokens(chars)).toBe(expected);
  });

  it('estimates audio at 32 tokens per second, ceiled', () => {
    expect(estimateAudioTokens(0)).toBe(0);
    expect(estimateAudioTokens(10)).toBe(10 * AUDIO_TOKENS_PER_SECOND);
    expect(estimateAudioTokens(0.1)).toBe(4); // ceil(3.2)
  });

  it('estimates video at default-resolution tokens per second, ceiled', () => {
    expect(estimateVideoTokens(0)).toBe(0);
    expect(estimateVideoTokens(10)).toBe(10 * VIDEO_TOKENS_PER_SECOND);
    expect(estimateVideoTokens(0.01)).toBe(3); // ceil(2.63)
  });
});

describe('estimatePreRunCost', () => {
  it('costs input and output tokens at the model pricing table', () => {
    const est = estimatePreRunCost(MODELS.flashLite, 2 * M_TOK, M_TOK);
    expect(est.estimatedCostUsd).toBeCloseTo(2 * 0.1 + 1 * 0.4, 10);
    expect(est.inputTokens).toBe(2 * M_TOK);
    expect(est.outputTokens).toBe(M_TOK);
  });

  it('falls back to the flash tier for unknown models', () => {
    const est = estimatePreRunCost('gemini-unknown', M_TOK, M_TOK);
    expect(est.estimatedCostUsd).toBeCloseTo(
      FALLBACK_PRICING.inputUsdPerMTok + FALLBACK_PRICING.outputUsdPerMTok,
      10,
    );
  });

  it('costs zero tokens at zero dollars', () => {
    expect(estimatePreRunCost(MODELS.flash, 0, 0).estimatedCostUsd).toBe(0);
  });
});

describe('estimateFlowCost', () => {
  it('sums per-call estimates across models', () => {
    const total = estimateFlowCost(
      estimatePreRunCost(MODELS.tts, 100, 200),
      estimatePreRunCost(MODELS.flashLite, 10, 20),
    );
    expect(total.inputTokens).toBe(110);
    expect(total.outputTokens).toBe(220);
    expect(total.estimatedCostUsd).toBeCloseTo(
      (100 / M_TOK) * 0.5 + (200 / M_TOK) * 10 + (10 / M_TOK) * 0.1 + (20 / M_TOK) * 0.4,
      10,
    );
  });

  it('returns zeros for no operations', () => {
    expect(estimateFlowCost()).toEqual({ inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 });
  });
});

describe('estimateTtsCost', () => {
  it('estimates input from script length and output from spoken duration', () => {
    // 1300 chars ≈ 100 s of speech → 325 input tokens, 2500 output audio tokens
    const est = estimateTtsCost(1300);
    expect(est.inputTokens).toBe(325);
    expect(est.outputTokens).toBe(2500);
    expect(est.estimatedCostUsd).toBeCloseTo((325 / M_TOK) * 0.5 + (2500 / M_TOK) * 10, 10);
  });

  it('estimates an empty script at zero cost', () => {
    expect(estimateTtsCost(0).estimatedCostUsd).toBe(0);
  });
});

describe('estimateTranscriptionCost', () => {
  it('estimates input from audio duration and output from spoken text', () => {
    // 10 s audio → 320 audio tokens + 48 prompt tokens in; 130 spoken chars → 33 tokens out
    const est = estimateTranscriptionCost(10);
    expect(est.inputTokens).toBe(368);
    expect(est.outputTokens).toBe(33);
    expect(est.estimatedCostUsd).toBeCloseTo((368 / M_TOK) * 0.1 + (33 / M_TOK) * 0.4, 10);
  });
});

describe('estimateVideoAnalysisCost', () => {
  it('estimates input from video duration', () => {
    // 20 s video → 5260 video tokens + 25 prompt tokens in; fixed 150 tokens out
    const est = estimateVideoAnalysisCost(20);
    expect(est.inputTokens).toBe(5285);
    expect(est.outputTokens).toBe(150);
    expect(est.estimatedCostUsd).toBeCloseTo((5285 / M_TOK) * 0.1 + (150 / M_TOK) * 0.4, 10);
  });
});

describe('post-processing estimators', () => {
  const input = { transcriptionChars: 4000, segmentChars: 4000, analysisChars: 1200 };

  it('costs description generation at the flash tier', () => {
    // 9630 chars → ceil(9630/4) = 2408 input tokens, 350 output tokens
    const est = estimateDescriptionCost(input);
    expect(est.inputTokens).toBe(2408);
    expect(est.outputTokens).toBe(350);
    expect(est.estimatedCostUsd).toBeCloseTo((2408 / M_TOK) * 0.3 + (350 / M_TOK) * 2.5, 10);
  });

  it('costs key-moment identification at the flash tier with its own prompt size', () => {
    // 9610 chars → ceil(9610/4) = 2403 input tokens, 250 output tokens
    const est = estimateKeyMomentsCost(input);
    expect(est.inputTokens).toBe(2403);
    expect(est.outputTokens).toBe(250);
    expect(est.estimatedCostUsd).toBeCloseTo((2403 / M_TOK) * 0.3 + (250 / M_TOK) * 2.5, 10);
  });

  it('scales with the actual input size', () => {
    const small = estimateDescriptionCost({ transcriptionChars: 0, segmentChars: 0, analysisChars: 0 });
    const large = estimateDescriptionCost(input);
    expect(large.estimatedCostUsd).toBeGreaterThan(small.estimatedCostUsd);
  });
});

describe('estimateAlignmentFlowCost', () => {
  it('includes transcription, per-clip analysis, and alignment when transcription will run', () => {
    const est = estimateAlignmentFlowCost({
      transcriptionDurationSec: 60,
      transcriptionChars: 0,
      unanalyzedClipDurationsSec: [10, 20],
      analysisChars: 900,
    });
    // analysis(10s): 2655 in / 150 out — analysis(20s): 5285 in / 150 out
    // alignment: (60×13 + 900 + 1200) chars → 720 in / 300 out
    // transcription(60s): 1920 + 48 in / 195 out
    expect(est.inputTokens).toBe(2655 + 5285 + 720 + 1968);
    expect(est.outputTokens).toBe(150 + 150 + 300 + 195);
    expect(est.estimatedCostUsd).toBeCloseTo(0.0013808, 10);
  });

  it('skips the transcription call when the voiceover is already transcribed', () => {
    const est = estimateAlignmentFlowCost({
      transcriptionDurationSec: 0,
      transcriptionChars: 6000,
      unanalyzedClipDurationsSec: [],
      analysisChars: 900,
    });
    // alignment only: (6000 + 900 + 1200) chars → 2025 in / 300 out
    expect(est.inputTokens).toBe(2025);
    expect(est.outputTokens).toBe(300);
    expect(est.estimatedCostUsd).toBeCloseTo(0.0003225, 10);
  });
});

describe('estimateNarrationFlowCost', () => {
  it('analyzes un-analyzed clips, writes the script, and voices it', () => {
    const est = estimateNarrationFlowCost([
      { durationSec: 30, analysisChars: null },
      { durationSec: 20, analysisChars: 600 },
    ]);
    // analysis(30s): 7915 in / 150 out — script: (90 + 600 + 280) chars → 243 in, script 650 chars → 163 out
    // tts: 650 chars → 163 in / 50 s × 25 = 1250 out
    expect(est.inputTokens).toBe(7915 + 243 + 163);
    expect(est.outputTokens).toBe(150 + 163 + 1250);
    expect(est.estimatedCostUsd).toBeCloseTo(0.0135225, 10);
  });

  it('reuses existing analyses without re-costing video tokens', () => {
    const est = estimateNarrationFlowCost([{ durationSec: 30, analysisChars: 600 }]);
    // script: (600 + 280) chars → 220 in, script 390 chars → 98 out — tts: 98 in / 750 out
    expect(est.inputTokens).toBe(220 + 98);
    expect(est.outputTokens).toBe(98 + 750);
  });
});

describe('formatEstimatedCost', () => {
  it.each([
    [0, '$0'],
    [-0.5, '$0'],
    [NaN, '$0'],
    [Infinity, '$0'],
    [0.00001, '<$0.0001'],
    [0.0001625, '$0.0002'],
    [0.001, '$0.0010'],
    [0.0251625, '$0.025'],
    [0.5, '$0.500'],
    [1.234, '$1.20'],
    [123.456, '$120.00'],
  ])('formats %p as %s', (usd, expected) => {
    expect(formatEstimatedCost(usd)).toBe(expected);
  });
});
