import { GoogleGenAI } from "@google/genai";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { getApiKey } from "./apiKey";
import { finishLog } from "./logger";
import type { LogEntry } from "./logger";

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
 * Routes a generateContent call through the shared client. When a log entry
 * (from `startLog`) is passed, the wrapper finishes it — success on response,
 * error with a normalized message on failure — and always rethrows the
 * original error so callers keep full fidelity for their own handling.
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
    if (log) finishLog(log, normalizeErrorMessage(err));
    throw err;
  }
}
