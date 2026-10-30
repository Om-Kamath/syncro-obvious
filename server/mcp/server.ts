import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerProjectResources } from './resources';
import type { ProjectReader } from './projectStore';

export const MCP_SERVER_NAME = 'syncro';
export const MCP_SERVER_VERSION = '0.1.0';

/**
 * MCP server factory: wires the saved-project resources onto a fresh server
 * instance with the `resources` capability. All behavior lives in
 * `resources.ts` — this is composition only, so tests get a fresh server per call.
 */
export function createSyncroMcpServer(store: ProjectReader): Server {
  const server = new Server(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { resources: {} } },
  );
  registerProjectResources(server, store);
  return server;
}
