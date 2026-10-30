import { MODELS } from "./models";

/**
 * Per-model Gemini pricing, USD per 1M tokens, paid tier (Standard).
 *
 * Source: the Gemini API pricing page at ai.google.dev (checked 2026-10-30).
 * The flash and TTS rates below are the "through December 31, 2026" figures;
 * they double on 2027-01-01, so re-check the pricing page when that date passes.
 */
export interface ModelPricing {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  /**
   * Output is generated audio (TTS): unlike text generation, pre-run output
   * cost is estimable from the script, because speech duration is predictable
   * from its text.
   */
  audioOutput?: boolean;
}

export const PRICING: Record<string, ModelPricing> = {
  [MODELS.tts]: { inputUsdPerMTok: 0.5, outputUsdPerMTok: 9, audioOutput: true },
  [MODELS.flashLite]: { inputUsdPerMTok: 0.3, outputUsdPerMTok: 2.5 },
  [MODELS.flash]: { inputUsdPerMTok: 0.75, outputUsdPerMTok: 3.75 },
};

// ---------------------------------------------------------------------
// Tokenization approximations for pre-run estimates (estimateCostFromInput).
// Real token counts always win: once usageMetadata is captured (post-run),
// use estimateCost instead — these heuristics exist only to price a call
// before it happens.
// ---------------------------------------------------------------------

/** English-ish text ≈ 4 chars per token (standard ballpark used across LLM tooling). */
export const CHARS_PER_TOKEN = 4;

/**
 * Audio/video input tokenizes at 25 tokens per second. The pricing page states
 * this rate for Gemini audio ("Audio tokens correspond to 25 tokens per second
 * of audio"); exact multimodal tokenization on flash models may differ — this
 * is an estimate, not a bill.
 */
export const MEDIA_TOKENS_PER_SEC = 25;

/** TTS audio output is billed at 25 tokens per second of audio (per the pricing page). */
export const TTS_TOKENS_PER_SEC = 25;

/**
 * Speech rate for estimating TTS output duration from script length:
 * ~14 characters of script per second of spoken audio (≈ 160 wpm at 5.6 chars/word).
 * Only used when the caller doesn't know the target audio duration.
 */
export const TTS_CHARS_PER_SEC = 14;

/** Token usage — from response.usageMetadata (post-run) or estimated (pre-run). */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** What the caller knows about a call's size before running it. */
export interface InputSize {
  /** Text length in characters (scripts, transcriptions, prompts). */
  chars?: number;
  /** Media duration in seconds (audio/video sent for transcription/analysis). */
  durationSec?: number;
}

/** Pre-run estimate with its breakdown, so the UI can label what was guessed. */
export interface CostEstimate {
  inputTokens: number;
  /** 0 for text models — output is unknowable pre-run; non-zero only for TTS. */
  outputTokens: number;
  costUsd: number;
}

/** Looks up pricing for a model id, failing loudly on unknown models — a silent $0 would understate cost. */
export function getPricing(model: string): ModelPricing {
  const pricing = PRICING[model];
  if (!pricing) {
    throw new Error(
      `No pricing registered for model "${model}". Known models: ${Object.keys(PRICING).join(", ")}`
    );
  }
  return pricing;
}

/** Post-run cost from real token counts (e.g. response.usageMetadata), in USD. */
export function estimateCost(model: string, tokens: TokenUsage): number {
  const pricing = getPricing(model);
  return (
    (tokens.inputTokens * pricing.inputUsdPerMTok +
      tokens.outputTokens * pricing.outputUsdPerMTok) /
    1_000_000
  );
}

/**
 * Pre-run cost estimate from input size, in USD.
 *
 * - Text models: input tokens from chars and/or media duration. Output tokens
 *   are unknowable before the call, so this is an input-side floor.
 * - TTS: input tokens from script chars; output audio duration from
 *   `durationSec` if given, else from chars at the speech-rate heuristic —
 *   so the estimate covers both sides of the bill.
 */
export function estimateCostFromInput(model: string, input: InputSize): CostEstimate {
  const pricing = getPricing(model);

  if (pricing.audioOutput) {
    // TTS input is the script text only; durationSec (if given) is the target
    // output audio duration, not media input.
    const inputTokens = Math.ceil((input.chars ?? 0) / CHARS_PER_TOKEN);
    const audioSeconds = input.durationSec ?? (input.chars ?? 0) / TTS_CHARS_PER_SEC;
    const outputTokens = Math.ceil(audioSeconds * TTS_TOKENS_PER_SEC);
    return { inputTokens, outputTokens, costUsd: estimateCost(model, { inputTokens, outputTokens }) };
  }

  const inputTokens = Math.ceil(
    (input.chars ?? 0) / CHARS_PER_TOKEN + (input.durationSec ?? 0) * MEDIA_TOKENS_PER_SEC
  );
  return { inputTokens, outputTokens: 0, costUsd: estimateCost(model, { inputTokens, outputTokens: 0 }) };
}
