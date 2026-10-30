import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SyncroApiClient } from './apiClient';
import { registerGenerationTools } from './generationTools';
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  createSyncroMcpServer,
  parseMaxUploadBytes,
} from './mediaTools';

// Logs go to stderr: stdout carries the MCP protocol on stdio transports.
const baseUrl = process.env.SYNCRO_SERVER_URL ?? 'http://localhost:3001';
const parsedLimit = parseMaxUploadBytes(process.env.SYNCRO_MCP_MAX_UPLOAD_BYTES);
if (parsedLimit === null && process.env.SYNCRO_MCP_MAX_UPLOAD_BYTES !== undefined) {
  console.error(
    `[syncro-mcp] ignoring invalid SYNCRO_MCP_MAX_UPLOAD_BYTES "${process.env.SYNCRO_MCP_MAX_UPLOAD_BYTES}" — using default`,
  );
}
const maxUploadBytes = parsedLimit ?? DEFAULT_MAX_UPLOAD_BYTES;

const apiClient = new SyncroApiClient({ baseUrl });
const server = createSyncroMcpServer({ apiClient, maxUploadBytes });
// Generation tools (narration, TTS, captions) call Gemini directly from this
// process and need GEMINI_API_KEY; failures surface as isError tool results.
registerGenerationTools(server);

await server.connect(new StdioServerTransport());
console.error(
  `[syncro-mcp] ready — Syncro API at ${baseUrl} (max upload ${maxUploadBytes} bytes)` +
    (process.env.GEMINI_API_KEY ? '' : ' — GEMINI_API_KEY not set, generation tools will fail'),
);
