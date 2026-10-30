import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { createSyncroMcpServer, DEFAULT_MAX_UPLOAD_BYTES } from './mediaTools';
import { SyncroApiClient } from './apiClient';
import { InMemoryProjectStore } from '../../src/mcp/projectStore';
import type { TimelineProjectState } from '../../src/mcp/timeline';
import { startMcpHttpServer, type RunningMcpHttpServer } from './httpApp';

// Never called — get_timeline reads the store directly; this test exercises
// no API-backed tool.
const apiClient = new SyncroApiClient({
  baseUrl: 'http://syncro.test',
  fetch: (async () => {
    throw new Error('Syncro API is not expected to be called in this test');
  }) as typeof fetch,
});

const project: TimelineProjectState = {
  id: 'proj-launch-teaser',
  name: 'Launch teaser',
  clips: [
    { id: 'clip-1', name: 'intro.mp4', duration: 12.5, startTime: 0, track: 0 },
    // Stale stored startTime — get_timeline must recompute the chain (12.5).
    { id: 'clip-2', name: 'demo.mp4', duration: 4, startTime: 0, track: 0 },
  ],
};

const store = new InMemoryProjectStore().put(project);

let running: RunningMcpHttpServer;
let client: Client;

beforeAll(async () => {
  running = await startMcpHttpServer({
    createServer: () =>
      createSyncroMcpServer({ apiClient, maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES, projectStore: store }),
    port: 0,
  });
  client = new Client({ name: 'vitest-client', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${running.port}/mcp`)),
  );
}, 15_000);

afterAll(async () => {
  await client?.close();
  await running?.close();
});

function textOf(result: CallToolResult): string {
  const block = result.content[0];
  if (!block || block.type !== 'text') {
    throw new Error('expected a text content block');
  }
  return block.text;
}

describe('MCP over streamable HTTP', () => {
  it('connects and lists the server tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    // Project read+mutation tools and media tools from the shared factory
    // (projectTools registered by main's #85), plus the get_timeline
    // registration this branch wires in.
    expect(names).toEqual([
      'attach_media',
      'create_project',
      'delete_project',
      'get_project',
      'get_timeline',
      'list_projects',
      'update_project',
      'upload_media',
    ]);
  }, 15_000);

  it('calls the read-only get_timeline tool over HTTP', async () => {
    const result = (await client.callTool({
      name: 'get_timeline',
      arguments: { projectId: project.id },
    })) as CallToolResult;
    expect(result.isError).toBeUndefined();
    const snapshot = JSON.parse(textOf(result)) as {
      projectId: string;
      name: string;
      playhead: number;
      duration: number;
      clipCount: number;
      clips: Array<{ id: string; order: number; startTime: number; duration: number }>;
    };
    expect(snapshot.projectId).toBe(project.id);
    expect(snapshot.name).toBe('Launch teaser');
    expect(snapshot.playhead).toBe(0);
    expect(snapshot.clipCount).toBe(2);
    expect(snapshot.duration).toBe(16.5);
    // Chain recomputed from array order, not the stale stored startTimes.
    expect(snapshot.clips.map((clip) => clip.startTime)).toEqual([0, 12.5]);
  }, 15_000);

  it('reports unknown project ids as a tool error, not a crash', async () => {
    const result = (await client.callTool({
      name: 'get_timeline',
      arguments: { projectId: 'does-not-exist' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Project not found: does-not-exist');
  }, 15_000);

  it('rejects requests presenting an unknown session id with 404', async () => {
    const response = await fetch(`http://127.0.0.1:${running.port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-session-id': 'bogus-session' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe('Session not found');
  }, 15_000);
});
