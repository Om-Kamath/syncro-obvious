import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { SyncroApiClient, type FetchLike, type ProjectRecord } from './apiClient';
import { createSyncroMcpServer } from './mediaTools';
import { makeProject } from './mockApi';

/** Connect a real MCP client to a fresh tool server over an in-memory transport pair. */
async function connectTools(fetchImpl: FetchLike): Promise<Client> {
  const apiClient = new SyncroApiClient({ baseUrl: 'http://syncro.test', fetch: fetchImpl });
  const server = createSyncroMcpServer({ apiClient, maxUploadBytes: 1024 * 1024 });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function resultText(result: CallToolResult): string {
  const first = result.content[0];
  if (!first || first.type !== 'text') throw new Error('expected text content in tool result');
  return first.text;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

describe('syncro MCP read tools (in process)', () => {
  it('registers the project read tools alongside the media tools', async () => {
    const client = await connectTools((async () => new Response('[]', { status: 200 })) as FetchLike);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'attach_media',
        'create_project',
        'delete_project',
        'get_project',
        'list_projects',
        'update_project',
        'upload_media',
      ]);
      expect(tools.find((t) => t.name === 'get_project')?.annotations).toMatchObject({ readOnlyHint: true });
      expect(tools.find((t) => t.name === 'list_projects')?.annotations).toMatchObject({ readOnlyHint: true });
    } finally {
      await client.close();
    }
  });

  it('lists projects and fetches one by id through the REST client', async () => {
    const projects: ProjectRecord[] = [
      makeProject({ id: 'proj_live' }),
      makeProject({ id: 'proj_other', name: 'Other' }),
    ];
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/api/projects')) return new Response(JSON.stringify(projects), { status: 200 });
      const id = decodeURIComponent(url.split('/').pop() ?? '');
      const project = projects.find((p) => p.id === id);
      return new Response(JSON.stringify(project ?? { error: `Project not found: ${id}` }), {
        status: project ? 200 : 404,
      });
    }) as unknown as FetchLike;
    const client = await connectTools(fetchImpl);
    try {
      const list = await callTool(client, 'list_projects', {});
      expect(list.isError).toBeFalsy();
      expect(JSON.parse(resultText(list))).toEqual(projects);

      const got = await callTool(client, 'get_project', { id: 'proj_live' });
      expect(got.isError).toBeFalsy();
      expect(JSON.parse(resultText(got))).toEqual(projects[0]);
      expect(calls).toHaveLength(2);
    } finally {
      await client.close();
    }
  });

  it('surfaces API failures as error results and keeps the session usable', async () => {
    const notFound = (async () =>
      new Response(JSON.stringify({ error: 'Project not found: nope' }), { status: 404 })) as unknown as FetchLike;
    const client = await connectTools(notFound);
    try {
      const missing = await callTool(client, 'get_project', { id: 'nope' });
      expect(missing.isError).toBe(true);
      expect(resultText(missing)).toBe('Syncro API error (status 404): Project not found: nope');

      // The session survives expected failures: a later call still round-trips.
      const later = await callTool(client, 'list_projects', {});
      expect(later.isError).toBe(true);
      expect(resultText(later)).toBe('Syncro API error (status 404): Project not found: nope');
    } finally {
      await client.close();
    }
  });

  it('rejects malformed get_project arguments at the protocol boundary', async () => {
    const client = await connectTools((async () => new Response('{}', { status: 200 })) as FetchLike);
    try {
      // The SDK validates the zod shape and answers with an error result.
      const bad = await callTool(client, 'get_project', {});
      expect(bad.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});
