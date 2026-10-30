import { pathToFileURL } from 'node:url';
import { resolveMcpHttpPort } from './args';
import { startMcpHttpServer } from './httpApp';
import { SyncroApiClient } from './apiClient';
import { createSyncroMcpServer, DEFAULT_MAX_UPLOAD_BYTES } from './mediaTools';
import { InMemoryProjectStore } from '../../src/mcp/projectStore';

/**
 * Entry point: run the Syncro MCP server over streamable HTTP.
 *   npm run mcp:http                        # default port 3010 on 127.0.0.1
 *   npm run mcp:http -- --port=4000
 *   SYNCRO_MCP_PORT=4000 npm run mcp:http
 *
 * Tools talk to the Syncro REST API (SYNCRO_SERVER_URL, default
 * http://localhost:3001 — same convention as the stdio entry).
 */
export async function main(argv: string[] = process.argv.slice(2), envPort?: string): Promise<void> {
  let port: number;
  try {
    port = resolveMcpHttpPort(argv, envPort ?? process.env.SYNCRO_MCP_PORT);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }
  const baseUrl = process.env.SYNCRO_SERVER_URL ?? 'http://localhost:3001';
  const apiClient = new SyncroApiClient({ baseUrl });
  // The in-memory store is the seam where the DB-backed projects store
  // (saved-projects API) plugs in; until then get_timeline reads are
  // session-local.
  const projectStore = new InMemoryProjectStore();
  const running = await startMcpHttpServer({
    createServer: () =>
      createSyncroMcpServer({
        apiClient,
        maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
        projectStore,
      }),
    port,
  });
  console.error(
    `[syncro-mcp] ready — streamable HTTP on http://127.0.0.1:${running.port}/mcp (Syncro API at ${baseUrl})`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
