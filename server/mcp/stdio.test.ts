import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { makeProject, startMockProjectApi, type MockApi } from './mockApi';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// tsx's bin entry (package.json exports block ./dist/cli.mjs, but the file is the bin target).
const tsxCli = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');
const serverEntry = path.join(repoRoot, 'server', 'mcp', 'index.ts');

let api: MockApi;
let transport: StdioClientTransport;

function spawnServerTransport(): StdioClientTransport {
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [tsxCli, serverEntry],
    // Spawn env is strings at runtime; undefined-valued keys from process.env are inert.
    env: { ...process.env, SYNCRO_SERVER_URL: api.baseUrl } as Record<string, string>,
  });
  return transport;
}

async function connectStdio(): Promise<Client> {
  const client = new Client({ name: 'inspector-script', version: '0.0.0' });
  await client.connect(spawnServerTransport());
  return client;
}

function firstText(result: CallToolResult): string {
  const block = result.content[0];
  expect(block?.type).toBe('text');
  return block?.type === 'text' ? block.text : '';
}

afterEach(async () => {
  await transport?.close();
  transport = undefined as unknown as StdioClientTransport;
  await api?.close();
  api = undefined as unknown as MockApi;
});

describe('syncro MCP server over stdio (scripted inspector)', () => {
  it('lists its tools as a real MCP client would', async () => {
    api = await startMockProjectApi([makeProject()]);
    const client = await connectStdio();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'attach_media',
        'create_project',
        'delete_project',
        'export_captions',
        'generate_captions',
        'generate_description',
        'generate_narration',
        'generate_thumbnails',
        'generate_tts',
        'get_project',
        'list_projects',
        'update_project',
        'upload_media',
      ]);
      const getProject = tools.find((t) => t.name === 'get_project');
      expect(getProject?.description).toContain('project');
      expect(getProject?.inputSchema).toMatchObject({
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      });
      expect(getProject?.annotations).toMatchObject({ readOnlyHint: true });
    } finally {
      await client.close();
    }
  });

  it('calls list_projects and get_project end to end', async () => {
    const projects = [makeProject({ id: 'proj_live' }), makeProject({ id: 'proj_other', name: 'Other' })];
    api = await startMockProjectApi(projects);
    const client = await connectStdio();
    try {
      const listResult = (await client.callTool({ name: 'list_projects', arguments: {} })) as CallToolResult;
      expect(listResult.isError).toBeFalsy();
      expect(JSON.parse(firstText(listResult))).toEqual(projects);

      const getResult = (await client.callTool({
        name: 'get_project',
        arguments: { id: 'proj_live' },
      })) as CallToolResult;
      expect(getResult.isError).toBeFalsy();
      expect(JSON.parse(firstText(getResult))).toEqual(projects[0]);
    } finally {
      await client.close();
    }
  });

  it('reports get_project on a missing id as a tool error', async () => {
    api = await startMockProjectApi([]);
    const client = await connectStdio();
    try {
      const result = (await client.callTool({
        name: 'get_project',
        arguments: { id: 'nope' },
      })) as CallToolResult;
      expect(result.isError).toBe(true);
      expect(firstText(result)).toBe('Syncro API error (status 404): Project not found: nope');
    } finally {
      await client.close();
    }
  });
}, 30_000);
