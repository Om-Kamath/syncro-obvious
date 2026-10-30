import { GoogleGenAI } from "@google/genai";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { getApiKey } from "./apiKey";
import { finishLog } from "./logger";
import type { FailureCost, LogEntry } from "./logger";

/**
 * Shared Gemini client module — the ONLY place in the codebase that constructs
 * `GoogleGenAI`. All Gemini traffic (models + Files API) goes through
 * `getAI()` / `generateContent()` so cross-cutting concerns (logging, usage
 * capture, error normalization) have a single seam.
 */

const MISSING_KEY_MESSAGE =
  'No Gemini API key set. Click the key icon in the header to add one.';

export function getAI(): GoogleGenAI {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error(MISSING_KEY_MESSAGE);
  return new GoogleGenAI({ apiKey });
}

/**
 * Single flattening rule for logged error text: Error instances keep their
 * message, plain strings pass through, and anything else is serialized so the
 * LogPanel never shows "[object Object]".
 */
export function normalizeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Token-usage shape the Gemini API reports, as carried on an error object when
 * a call fails after tokens were processed. Field names mirror the API.
 */
interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

function isUsageMetadata(value: unknown): value is UsageMetadata {
  if (typeof value !== 'object' || value === null) return false;
  const u = value as Record<string, unknown>;
  return (
    typeof u.promptTokenCount === 'number' ||
    typeof u.candidatesTokenCount === 'number' ||
    typeof u.totalTokenCount === 'number'
  );
}

function findUsageMetadata(err: unknown): UsageMetadata | undefined {
  const carriers = [
    err,
    (err as { error?: unknown } | null | undefined)?.error,
    (err as { response?: unknown } | null | undefined)?.response,
  ];
  for (const carrier of carriers) {
    const usage = (carrier as { usageMetadata?: unknown } | null | undefined)?.usageMetadata;
    if (isUsageMetadata(usage)) return usage;
  }
  return undefined;
}

/**
 * Honest cost state for a failed call: tokens the API reports as consumed
 * (0 when nothing is observable) and whether that consumption was billed.
 * Transport and quota errors carry no usage data — those cost nothing, and
 * the log says so instead of leaving the cost unknown.
 */
export function extractFailureCost(err: unknown): FailureCost {
  const usage = findUsageMetadata(err);
  if (!usage) return { tokensConsumed: 0, billed: false };
  const tokens =
    usage.totalTokenCount ?? (usage.promptTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0);
  return { tokensConsumed: tokens, billed: tokens > 0 };
}

/**
 * Routes a generateContent call through the shared client. When a log entry
 * (from `startLog`) is passed, the wrapper finishes it — success on response,
 * error with a normalized message and honest cost state on failure — and
 * always rethrows the original error so callers keep full fidelity for their
 * own handling.
 */
export async function generateContent(
  params: GenerateContentParameters,
  log?: LogEntry
): Promise<GenerateContentResponse> {
  try {
    const response = await getAI().models.generateContent(params);
    if (log) finishLog(log);
    return response;
  } catch (err) {
    if (log) finishLog(log, normalizeErrorMessage(err), extractFailureCost(err));
    throw err;
  }
}
