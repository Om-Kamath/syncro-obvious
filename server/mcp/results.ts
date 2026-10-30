import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SyncroApiError } from './apiClient';

/** Expected tool failure — rendered as an `isError` result, never a crash. */
export class ToolFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolFailure';
  }
}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

/** Widen to `unknown`: list-shaped payloads (e.g. the project index) are valid tool JSON too. */
export function jsonResult(payload: unknown): CallToolResult {
  return textResult(JSON.stringify(payload, null, 2));
}

export function errorResult(message: string): CallToolResult {
  return { isError: true, ...textResult(message) };
}

export function toErrorResult(error: unknown): CallToolResult {
  if (error instanceof ToolFailure) return errorResult(error.message);
  if (error instanceof SyncroApiError) {
    return errorResult(`Syncro API error (status ${error.status}): ${error.message}`);
  }
  // Unexpected failures still surface to the caller; the SDK wraps the thrown
  // error as an isError result so the MCP session survives the bug.
  throw error;
}
