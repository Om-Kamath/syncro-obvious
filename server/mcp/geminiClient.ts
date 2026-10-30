import { FileState, GoogleGenAI } from '@google/genai';
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { finishLog, type LogEntry } from '../../src/services/logger';
import { normalizeErrorMessage } from '../../src/services/geminiClient';
import { LruCache } from '../../src/utils/lruCache';
import { estimateCostUsd } from '../../src/services/costModel';

/**
 * Server-side Gemini client — the ONLY place in server code that constructs
 * `GoogleGenAI`. It mirrors the UI path (`src/services/geminiClient.ts`) with
 * two differences: the API key comes from the environment instead of
 * localStorage, and every call captures `usageMetadata` (token counts +
 * estimated cost) onto the log entry so MCP traffic is costed like UI traffic.
 */

const MISSING_KEY_MESSAGE =
  'GEMINI_API_KEY is not set. Export it before starting the Syncro MCP server.';

export function getServerAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error(MISSING_KEY_MESSAGE);
  return new GoogleGenAI({ apiKey });
}

/** Copies usageMetadata onto the log entry and prices the call. */
function captureUsage(log: LogEntry, model: string, response: GenerateContentResponse): void {
  const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
  log.inputTokens = inputTokens;
  log.outputTokens = outputTokens;
  log.estimatedCostUsd = estimateCostUsd(model, inputTokens, outputTokens);
}

/**
 * One-line stderr echo per finished call: a stdio MCP server owns stdout for
 * the JSON-RPC stream, so diagnostics must go to stderr. One line per op keeps
 * a running session legible in a terminal or container log.
 */
function echoToStderr(log: LogEntry): void {
  const tokens = `in=${log.inputTokens ?? '?'} out=${log.outputTokens ?? '?'}`;
  const cost = log.estimatedCostUsd === undefined ? 'n/a' : `${log.estimatedCostUsd.toFixed(6)}`;
  const err = log.error ? ` error="${log.error}"` : '';
  console.error(`[mcp] ${log.fn} ${log.status} ${log.durationMs}ms ${tokens} est=${cost}${err}`);
}

/**
 * Routes a generateContent call through the server client and finishes the
 * log entry (success, or error with a normalized message) exactly once —
 * tool handlers let errors propagate instead of re-finishing the log.
 */
export async function generateContent(
  params: GenerateContentParameters,
  log: LogEntry
): Promise<GenerateContentResponse> {
  try {
    const response = await getServerAI().models.generateContent(params);
    captureUsage(log, String(params.model), response);
    finishLog(log);
    echoToStderr(log);
    return response;
  } catch (err) {
    finishLog(log, normalizeErrorMessage(err));
    echoToStderr(log);
    throw err;
  }
}

// -------------------------------------------------------------------
// Files API — upload once, reuse URI across calls (same bounded-LRU
// and `${name}::${size}` key shape as the UI path in gemini.ts).
// -------------------------------------------------------------------
const FILE_URI_CACHE_MAX = 20;
const fileUriCache = new LruCache<string, string>(FILE_URI_CACHE_MAX);

/** Uploads raw audio bytes to the Files API and polls until ACTIVE. */
export async function uploadAudioBytes(
  bytes: Uint8Array,
  mimeType: string,
  name: string
): Promise<string> {
  const cacheKey = `${name}::${bytes.byteLength}`;
  const cachedUri = fileUriCache.get(cacheKey);
  if (cachedUri !== undefined) {
    console.debug(`[mcp] reusing cached URI for "${name}"`);
    return cachedUri;
  }

  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  const uploaded = await getServerAI().files.upload({
    file: blob,
    config: { mimeType, displayName: name },
  });

  let fileInfo = uploaded;
  while (fileInfo.state === FileState.PROCESSING) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    fileInfo = await getServerAI().files.get({ name: fileInfo.name! });
  }

  if (fileInfo.state === FileState.FAILED) {
    throw new Error(`File upload failed for "${name}": ${fileInfo.error?.message ?? 'unknown'}`);
  }

  const uri = fileInfo.uri!;
  fileUriCache.set(cacheKey, uri);
  return uri;
}
