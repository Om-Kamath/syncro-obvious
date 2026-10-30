import { GoogleGenAI } from "@google/genai";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { normalizeErrorMessage } from "../../src/services/geminiClient";

/**
 * Server-side Gemini plumbing — the MCP counterpart of src/services/geminiClient.ts.
 *
 * Same patterns as the browser path (single construction site, model registry,
 * a wrapped `generateContent` that captures duration + usage), with two
 * server-specific differences:
 * - the API key comes from the GEMINI_API_KEY environment variable, not
 *   localStorage;
 * - call logs are written to stderr (stdout carries the MCP protocol).
 *
 * Token usage is captured per call. Dollar-cost estimation is deliberately not
 * invented here — it lands with the cost-model workstream, which owns pricing.
 */

export const MISSING_SERVER_API_KEY_MESSAGE =
  "No Gemini API key available to the MCP server. Set GEMINI_API_KEY in the server environment.";

export interface GeminiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface GenerateResult {
  text: string;
  usage?: GeminiUsage;
}

export type GenerateFn = (params: GenerateContentParameters) => Promise<GenerateResult>;

export function requireServerApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error(MISSING_SERVER_API_KEY_MESSAGE);
  return apiKey;
}

/** Maps the SDK's usageMetadata onto a stable, optional field triple. */
export function extractUsage(response: GenerateContentResponse): GeminiUsage | undefined {
  const usage = response.usageMetadata;
  if (!usage) return undefined;
  return {
    promptTokens: usage.promptTokenCount,
    completionTokens: usage.candidatesTokenCount,
    totalTokens: usage.totalTokenCount,
  };
}

function logCall(model: string, startedAt: number, usage?: GeminiUsage, error?: string): void {
  const line = {
    fn: "mcp.generateContent",
    model,
    durationMs: Date.now() - startedAt,
    usage,
    error,
  };
  console.error(`[syncro-mcp] ${JSON.stringify(line)}`);
}

/**
 * Builds the generate function every MCP tool receives. Constructed per server
 * instance; fails fast when no environment key is configured.
 */
export function createGenerate(apiKey: string = requireServerApiKey()): GenerateFn {
  const ai = new GoogleGenAI({ apiKey });
  return async (params: GenerateContentParameters): Promise<GenerateResult> => {
    const startedAt = Date.now();
    const model = typeof params.model === "string" ? params.model : "unknown";
    try {
      const response = await ai.models.generateContent(params);
      const usage = extractUsage(response);
      logCall(model, startedAt, usage);
      return { text: response.text ?? "", usage };
    } catch (err) {
      logCall(model, startedAt, undefined, normalizeErrorMessage(err));
      throw err;
    }
  };
}
