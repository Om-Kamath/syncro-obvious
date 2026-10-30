/**
 * Estimated-cost model for Gemini calls.
 *
 * Rates are USD per 1M tokens, keyed by the ids pinned in the central model
 * registry (models.ts) — the only place model id strings may appear, per the
 * model-id-locality test. They are rough approximations of the public
 * per-1M-token rates — the UI always labels totals as estimates ("≈"), so
 * update these in place as pricing changes. Unknown models deliberately yield
 * no estimate rather than a guessed rate.
 */
import { MODELS } from './models';

const USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  [MODELS.flashLite]: { input: 0.1, output: 0.4 },
  [MODELS.flash]: { input: 0.3, output: 2.5 },
  [MODELS.tts]: { input: 0.5, output: 10.0 },
};

/** Returns the estimated USD cost for a call, or undefined when unpricable (unknown model / no usage). */
export function estimateCostUsd(model: string, inputTokens?: number, outputTokens?: number): number | undefined {
  const rate = USD_PER_MTOK[model];
  if (!rate || (inputTokens === undefined && outputTokens === undefined)) return undefined;
  return ((inputTokens ?? 0) * rate.input + (outputTokens ?? 0) * rate.output) / 1_000_000;
}

/** Formats a USD amount at four decimals; sub-precision amounts never round to $0.0000. */
export function formatUsd(cost: number): string {
  if (cost > 0 && cost < 0.0001) return '<$0.0001';
  return `$${cost.toFixed(4)}`;
}

/** Structural view of the fields summarizeCosts needs — keeps costModel decoupled from logger. */
export interface CostBearing {
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
}

export interface CostSummary {
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  /** Entries that carried a priceable usage report. */
  pricedCalls: number;
}

/**
 * Session-wide rollup for the LogPanel footer. Tokens are counted only when
 * the call could be priced, keeping the token totals and the cost total
 * self-consistent.
 */
export function summarizeCosts(entries: readonly CostBearing[]): CostSummary {
  const summary: CostSummary = { totalTokensIn: 0, totalTokensOut: 0, totalCostUsd: 0, pricedCalls: 0 };
  for (const entry of entries) {
    if (entry.estimatedCostUsd === undefined) continue;
    summary.pricedCalls += 1;
    summary.totalTokensIn += entry.inputTokens ?? 0;
    summary.totalTokensOut += entry.outputTokens ?? 0;
    summary.totalCostUsd += entry.estimatedCostUsd;
  }
  return summary;
}
