import { MODELS } from "./models";

/**
 * Pre-run cost estimation — shown next to every AI action before it runs.
 * Everything here is a pure function of input size: characters of text,
 * seconds of audio/video. Estimates are approximations by design — the UI
 * always labels them "est." and never treats them as billing truth.
 */

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export interface ModelPricing {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

/**
 * USD per 1M tokens, keyed by model id from the registry. The current GA
 * model ids have no published prices this codebase can verify against, so
 * the table carries the public prices of the series they replace — refresh
 * from ai.google.dev/pricing when real values are available. The tested
 * contract is the arithmetic (tokens × price), not these table values.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  [MODELS.tts]: { inputUsdPerMTok: 0.5, outputUsdPerMTok: 10 },
  [MODELS.flashLite]: { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.4 },
  [MODELS.flash]: { inputUsdPerMTok: 0.3, outputUsdPerMTok: 2.5 },
};

/** Unknown models price at the higher flash tier — over-estimating beats under-estimating. */
export const FALLBACK_PRICING: ModelPricing = MODEL_PRICING[MODELS.flash];

export function getPricing(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? FALLBACK_PRICING;
}

// ---------------------------------------------------------------------------
// Token estimation from input size — declared approximations
// ---------------------------------------------------------------------------

/** English-prose tokenization heuristic. */
export const CHARS_PER_TOKEN = 4;
/** Gemini represents each second of audio as ~32 tokens. */
export const AUDIO_TOKENS_PER_SECOND = 32;
/** Gemini default media resolution represents each second of video as ~263 tokens. */
export const VIDEO_TOKENS_PER_SECOND = 263;
/** Narrated speech ≈ 150 words/min at ~5 chars/word. */
export const SPEECH_CHARS_PER_SECOND = 13;
/** TTS bills generated audio at ~25 tokens per second of speech. */
export const TTS_OUTPUT_TOKENS_PER_SECOND = 25;
/** Clip-analysis output ≈ 3 chars of description per second of video (~60 words for a 20 s clip). */
export const ANALYSIS_CHARS_PER_SECOND = 3;

export function estimateTextTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);
}

export function estimateAudioTokens(durationSec: number): number {
  return Math.ceil(Math.max(0, durationSec) * AUDIO_TOKENS_PER_SECOND);
}

export function estimateVideoTokens(durationSec: number): number {
  return Math.ceil(Math.max(0, durationSec) * VIDEO_TOKENS_PER_SECOND);
}

// ---------------------------------------------------------------------------
// Core estimator
// ---------------------------------------------------------------------------

export interface PreRunEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

/** Costs one call: (tokens / 1M) × per-model price, input and output. */
export function estimatePreRunCost(model: string, inputTokens: number, outputTokens: number): PreRunEstimate {
  const pricing = getPricing(model);
  return {
    inputTokens,
    outputTokens,
    estimatedCostUsd:
      (inputTokens / 1_000_000) * pricing.inputUsdPerMTok +
      (outputTokens / 1_000_000) * pricing.outputUsdPerMTok,
  };
}

/** Sums per-call estimates (possibly across models) into one flow estimate. */
export function estimateFlowCost(...ops: PreRunEstimate[]): PreRunEstimate {
  return ops.reduce(
    (sum, op) => ({
      inputTokens: sum.inputTokens + op.inputTokens,
      outputTokens: sum.outputTokens + op.outputTokens,
      estimatedCostUsd: sum.estimatedCostUsd + op.estimatedCostUsd,
    }),
    { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
  );
}

// ---------------------------------------------------------------------------
// Per-operation estimators — one per AI action the UI can trigger
// ---------------------------------------------------------------------------

// Prompt-template lengths and output sizes are declared approximations,
// measured from the templates in gemini.ts / postProcessing.ts; refresh them
// if those prompts change materially.

const TRANSCRIPTION_PROMPT_OVERHEAD_CHARS = 190;
const NARRATION_PROMPT_OVERHEAD_CHARS = 280;
const ALIGNMENT_PROMPT_OVERHEAD_CHARS = 1200;
const ANALYSIS_PROMPT_OVERHEAD_CHARS = 100;
const DESCRIPTION_PROMPT_OVERHEAD_CHARS = 430;
const KEY_MOMENTS_PROMPT_OVERHEAD_CHARS = 410;

const ANALYSIS_OUTPUT_TOKENS = 150;
const ALIGNMENT_OUTPUT_TOKENS = 300;
const DESCRIPTION_OUTPUT_TOKENS = 350; // summary + 3–8 chapters + 8–12 hashtags
const KEY_MOMENTS_OUTPUT_TOKENS = 250; // 4–5 × {timestamp, quote, reason}

/** TTS from a script: input is the script text, output is generated audio. */
export function estimateTtsCost(scriptChars: number): PreRunEstimate {
  const spokenSec = Math.max(0, scriptChars) / SPEECH_CHARS_PER_SECOND;
  return estimatePreRunCost(
    MODELS.tts,
    estimateTextTokens(scriptChars),
    Math.ceil(spokenSec * TTS_OUTPUT_TOKENS_PER_SECOND),
  );
}

/** Transcription of an uploaded voiceover file — audio duration drives the cost. */
export function estimateTranscriptionCost(audioDurationSec: number): PreRunEstimate {
  return estimatePreRunCost(
    MODELS.flashLite,
    estimateAudioTokens(audioDurationSec) + estimateTextTokens(TRANSCRIPTION_PROMPT_OVERHEAD_CHARS),
    estimateTextTokens(Math.max(0, audioDurationSec) * SPEECH_CHARS_PER_SECOND),
  );
}

/** Video content analysis (part of the narration and alignment flows). */
export function estimateVideoAnalysisCost(videoDurationSec: number): PreRunEstimate {
  return estimatePreRunCost(
    MODELS.flashLite,
    estimateVideoTokens(videoDurationSec) + estimateTextTokens(ANALYSIS_PROMPT_OVERHEAD_CHARS),
    ANALYSIS_OUTPUT_TOKENS,
  );
}

export interface PostProcessingInput {
  transcriptionChars: number;
  segmentChars: number;
  analysisChars: number;
}

/** Description + chapters + hashtags from the transcription (flash tier). */
export function estimateDescriptionCost(input: PostProcessingInput): PreRunEstimate {
  const inputChars =
    input.transcriptionChars + input.segmentChars + input.analysisChars + DESCRIPTION_PROMPT_OVERHEAD_CHARS;
  return estimatePreRunCost(MODELS.flash, estimateTextTokens(inputChars), DESCRIPTION_OUTPUT_TOKENS);
}

/** Thumbnail key-moment identification from the transcription (flash tier). */
export function estimateKeyMomentsCost(input: PostProcessingInput): PreRunEstimate {
  const inputChars =
    input.transcriptionChars + input.segmentChars + input.analysisChars + KEY_MOMENTS_PROMPT_OVERHEAD_CHARS;
  return estimatePreRunCost(MODELS.flash, estimateTextTokens(inputChars), KEY_MOMENTS_OUTPUT_TOKENS);
}

export interface AlignmentFlowInput {
  /** Seconds of audio that still need transcription (0 when already transcribed). */
  transcriptionDurationSec: number;
  /** Known transcription text — the alignment prompt's narration input. */
  transcriptionChars: number;
  /** Durations of clips that still need video analysis. */
  unanalyzedClipDurationsSec: number[];
  /** Existing clip analyses, summed — the alignment prompt's visual input. */
  analysisChars: number;
}

/** Full Auto-Align flow: transcribe (if needed) + analyze un-analyzed clips + suggest alignment. */
export function estimateAlignmentFlowCost(input: AlignmentFlowInput): PreRunEstimate {
  const ops: PreRunEstimate[] = input.unanalyzedClipDurationsSec.map(estimateVideoAnalysisCost);
  // When transcription hasn't run yet, the alignment prompt's narration text
  // is estimated from the audio duration.
  const narrationChars =
    input.transcriptionChars + input.transcriptionDurationSec * SPEECH_CHARS_PER_SECOND;
  ops.push(estimatePreRunCost(
    MODELS.flashLite,
    estimateTextTokens(narrationChars + input.analysisChars + ALIGNMENT_PROMPT_OVERHEAD_CHARS),
    ALIGNMENT_OUTPUT_TOKENS,
  ));
  if (input.transcriptionDurationSec > 0) {
    ops.push(estimateTranscriptionCost(input.transcriptionDurationSec));
  }
  return estimateFlowCost(...ops);
}

export interface NarrationFlowClip {
  durationSec: number;
  /** Existing analysis text length; null when the clip still needs analysis. */
  analysisChars: number | null;
}

/** Full auto-narration flow: analyze clips + write the script + voice it (TTS). */
export function estimateNarrationFlowCost(clips: NarrationFlowClip[]): PreRunEstimate {
  const ops: PreRunEstimate[] = [];
  let analysisInputChars = 0;
  let totalDurationSec = 0;

  for (const clip of clips) {
    totalDurationSec += Math.max(0, clip.durationSec);
    if (clip.analysisChars === null) {
      ops.push(estimateVideoAnalysisCost(clip.durationSec));
      analysisInputChars += clip.durationSec * ANALYSIS_CHARS_PER_SECOND;
    } else {
      analysisInputChars += clip.analysisChars;
    }
  }

  // The narration prompt asks for a script matching the clips' spoken length,
  // so the TTS input is estimated from total clip duration.
  const scriptChars = totalDurationSec * SPEECH_CHARS_PER_SECOND;
  ops.push(estimatePreRunCost(
    MODELS.flashLite,
    estimateTextTokens(analysisInputChars + NARRATION_PROMPT_OVERHEAD_CHARS),
    estimateTextTokens(scriptChars),
  ));
  ops.push(estimateTtsCost(scriptChars));
  return estimateFlowCost(...ops);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Renders an estimate at its honest precision: two significant figures, so
 * "$0.0250" never pretends to be a measured bill.
 */
export function formatEstimatedCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0';
  const rounded = Number(usd.toPrecision(2));
  if (rounded < 0.0001) return '<$0.0001';
  if (rounded < 0.01) return `$${rounded.toFixed(4)}`;
  if (rounded < 1) return `$${rounded.toFixed(3)}`;
  return `$${rounded.toFixed(2)}`;
}
