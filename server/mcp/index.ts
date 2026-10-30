/**
 * Stdio entry for Syncro's MCP server: `npm run mcp`.
 *
 * Speaks MCP over stdin/stdout; wire it into any MCP client, e.g.:
 * `{ "mcpServers": { "syncro": { "command": "npm", "args": ["run", "mcp"] } } }`
 *
 * The MCP layer reads through `ProjectReader`, so swapping the in-memory store
 * for a persistent one never touches the resource code. Nothing is ever logged
 * to stdout — that stream carries the protocol.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { InMemoryProjectStore } from './projectStore';
import { createSyncroMcpServer } from './server';

await createSyncroMcpServer(new InMemoryProjectStore()).connect(new StdioServerTransport());
