import { describe, expect, it, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { buildSyncroMcpServer } from './mcpServer';
import { HttpProjectsApi } from './projectApi';
import type { ProjectsApi } from './projectApi';
import type { ProjectRecord, ProjectState, SerializedClip, SerializedVoiceover } from './types';

/**
 * Tool-call tests against a test server: every test drives a real MCP client
 * (in-memory transport) through the MCP server and the HTTP adapter into a
 * real express server implementing the projects REST contract on an
 * ephemeral port. No fetch mocking — failures surface as the agent would
 * see them.
 */

type CloseFn = () => void;

const closeFns: CloseFn[] = [];

afterEach(() => {
  for (const close of closeFns) close();
  closeFns.length = 0;
});

/**
 * Minimal stand-in for the Syncro projects API: same routes, status codes,
 * and error-body shape as the REST contract (`{ error }` on 404, 204 on
 * delete) with an in-memory Map instead of SQLite. The MCP layer's validator
 * is under test here, not the API's — payloads reach this server
 * pre-validated and are stored as-is.
 */
function startTestApi(): Promise<{ baseUrl: string; projects: Map<string, ProjectRecord> }> {
  const projects = new Map<string, ProjectRecord>();
  const app = express();
  app.use(express.json());

  app.post('/api/projects', (req, res) => {
    const { name, state } = req.body as { name: string; state: ProjectState };
    const now = new Date().toISOString();
    const record: ProjectRecord = { id: randomUUID(), name, state, createdAt: now, updatedAt: now };
    projects.set(record.id, record);
    res.status(201).location(`/api/projects/${record.id}`).json(record);
  });

  app.get('/api/projects/:id', (req, res) => {
    const record = projects.get(req.params.id);
    if (!record) {
      res.status(404).json({ error: `Project not found: ${req.params.id}` });
      return;
    }
    res.json(record);
  });

  app.put('/api/projects/:id', (req, res) => {
    const record = projects.get(req.params.id);
    if (!record) {
      res.status(404).json({ error: `Project not found: ${req.params.id}` });
      return;
    }
    const { name, state } = req.body as { name: string; state: ProjectState };
    const updated: ProjectRecord = { ...record, name, state, updatedAt: new Date().toISOString() };
    projects.set(req.params.id, updated);
    res.json(updated);
  });

  app.delete('/api/projects/:id', (req, res) => {
    if (!projects.delete(req.params.id)) {
      res.status(404).json({ error: `Project not found: ${req.params.id}` });
      return;
    }
    res.status(204).send();
  });

  const httpServer = app.listen(0);
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.once('listening', () => {
      const { port } = httpServer.address() as AddressInfo;
      closeFns.push(() => {
        httpServer.closeAllConnections();
        httpServer.close();
      });
      resolve({ baseUrl: `http://127.0.0.1:${port}`, projects });
    });
  });
}

/** Connect a real MCP client to a real MCP server instance over an in-memory transport pair. */
async function connectMcpClient(api: ProjectsApi): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([buildSyncroMcpServer(api).connect(serverTransport), client.connect(clientTransport)]);
  closeFns.push(() => void client.close());
  return client;
}

/** Call a tool with the response validated against the CallToolResult schema. */
async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  // No task is requested, so the SDK's task-based union member cannot appear;
  // narrowing keeps the cast out while pinning the result type.
  const result = await client.callTool({ name, arguments: args }, CallToolResultSchema);
  if ('toolResult' in result) throw new Error('unexpected task-based tool response');
  return result;
}

function baseClip(overrides: Partial<SerializedClip> = {}): SerializedClip {
  return {
    id: 'clip-1',
    name: 'intro.mp4',
    duration: 12.5,
    startTime: 0,
    trimmedDuration: 10,
    trimStart: 0.5,
    textOverlay: 'Hello',
    track: 0,
    transitionIn: 'fade',
    analysis: 'opens on a skyline',
    alternatives: [{ id: 'alt-1', confidence: 0.8, reason: 'better pacing' }],
    ...overrides,
  };
}

function validState(overrides: Partial<ProjectState> = {}): ProjectState {
  const voiceover: SerializedVoiceover = {
    duration: 10,
    trimStart: 0,
    trimEnd: 9.5,
    transcription: 'hello world',
    segments: [{ text: 'hello world', start: 0, end: 9.5 }],
    startTime: 0.25,
  };
  return {
    clips: [baseClip()],
    voiceover,
    captionStyle: { mode: 'word-highlight', fontSize: 32, color: '#ffffff', bgColor: '#000000', position: 'bottom' },
    captionsEnabled: true,
    ...overrides,
  };
}

function textOf(result: CallToolResult): string {
  const block = result.content[0] as { type: string; text?: string };
  if (block?.type !== 'text' || typeof block.text !== 'string') {
    throw new Error(`expected a text block, got: ${JSON.stringify(result.content)}`);
  }
  return block.text;
}

async function expectError(call: Promise<CallToolResult>): Promise<string> {
  const result = await call;
  expect(result.isError).toBe(true);
  return textOf(result);
}

function createdId(result: CallToolResult): string {
  expect(result.isError).toBeFalsy();
  return (result.structuredContent as ProjectRecord).id;
}

describe('tools/list', () => {
  it('exposes the three project mutation tools with object input schemas', async () => {
    const { baseUrl } = await startTestApi();
    const client = await connectMcpClient(new HttpProjectsApi(baseUrl));

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['create_project', 'delete_project', 'update_project']);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description).toBeTruthy();
    }
  });
});

describe('create_project', () => {
  it('creates a project through the API and returns the stored record', async () => {
    const { baseUrl, projects } = await startTestApi();
    const client = await connectMcpClient(new HttpProjectsApi(baseUrl));

    const result = await callTool(client, 'create_project', { name: 'Launch video', state: validState() });

    expect(result.isError).toBeFalsy();
    const record = result.structuredContent as ProjectRecord;
    expect(record.id).toBeTruthy();
    expect(record.name).toBe('Launch video');
    expect(record.state).toEqual(validState());
    expect(record.createdAt).toBe(record.updatedAt);

    const stored = projects.get(record.id);
    expect(stored).toEqual(record);
  });

  it('normalizes an omitted voiceover to null and drops unknown clip keys', async () => {
    const { baseUrl, projects } = await startTestApi();
    const client = await connectMcpClient(new HttpProjectsApi(baseUrl));

    const state = validState({
      voiceover: undefined,
      clips: [{ ...baseClip(), file: 'browser blob' } as unknown as SerializedClip],
    });
    const result = await callTool(client, 'create_project', { name: 'Clean', state });

    expect(result.isError).toBeFalsy();
    const record = result.structuredContent as ProjectRecord;
    expect(record.state.voiceover).toBeNull();
    expect(record.state.clips[0]).toEqual(baseClip());

    const stored = projects.get(record.id);
    expect(stored?.state).toEqual(record.state);
  });

  it.each([
    { label: 'blank name', args: { name: '   ', state: validState() }, message: 'name must be a non-empty string' },
    { label: 'missing state', args: { name: 'X' }, message: 'state must be an object' },
    { label: 'negative clip duration', args: { name: 'X', state: validState({ clips: [baseClip({ duration: -1 })] }) }, message: 'clips[0].duration must be >= 0' },
    { label: 'unknown transition', args: { name: 'X', state: validState({ clips: [baseClip({ transitionIn: 'zoom' as never })] }) }, message: 'clips[0].transitionIn must be one of' },
    { label: 'unknown caption mode', args: { name: 'X', state: validState({ captionStyle: { mode: 'karaoke' as never, fontSize: 32, color: '#fff', bgColor: '#000', position: 'bottom' } }) }, message: 'captionStyle.mode must be one of' },
    { label: 'segment start after end', args: { name: 'X', state: validState({ voiceover: { duration: 10, segments: [{ text: 'a', start: 5, end: 4 }] } }) }, message: 'voiceover.segments[0].start must be <= voiceover.segments[0].end' },
  ])('rejects $label locally without touching the API', async ({ args, message }) => {
    const { baseUrl, projects } = await startTestApi();
    const client = await connectMcpClient(new HttpProjectsApi(baseUrl));

    const text = await expectError(callTool(client, 'create_project', args));
    expect(text).toContain(message);
    expect(projects.size).toBe(0);
  });
});

describe('update_project', () => {
  it('replaces name and state, and the API reflects the change', async () => {
    const { baseUrl } = await startTestApi();
    const client = await connectMcpClient(new HttpProjectsApi(baseUrl));

    const id = createdId(
      await callTool(client, 'create_project', { name: 'Before', state: validState() }),
    );

    const updatedState = validState({
      clips: [baseClip(), baseClip({ id: 'clip-2', name: 'outro.mp4', startTime: 10 })],
    });
    const result = await callTool(client, 'update_project', { id, name: 'After', state: updatedState });

    expect(result.isError).toBeFalsy();
    const record = result.structuredContent as ProjectRecord;
    expect(record.name).toBe('After');
    expect(record.state.clips).toHaveLength(2);
    expect(record.updatedAt >= record.createdAt).toBe(true);

    // Read back over HTTP to verify server-side state.
    const refetched = await fetch(`${baseUrl}/api/projects/${id}`);
    expect(refetched.status).toBe(200);
    const stored = (await refetched.json()) as ProjectRecord;
    expect(stored.name).toBe('After');
    expect(stored.state.clips).toHaveLength(2);
  });

  it('rejects an unknown id with the API not-found error', async () => {
    const { baseUrl } = await startTestApi();
    const client = await connectMcpClient(new HttpProjectsApi(baseUrl));

    const text = await expectError(
      callTool(client, 'update_project', { id: 'no-such-id', name: 'Ghost', state: validState() }),
    );
    expect(text).toContain('Project not found: no-such-id');
  });

  it('rejects a missing id before issuing any request', async () => {
    const { baseUrl, projects } = await startTestApi();
    const client = await connectMcpClient(new HttpProjectsApi(baseUrl));

    const text = await expectError(callTool(client, 'update_project', { name: 'X', state: validState() }));
    expect(text).toContain('id must be a non-empty string');
    expect(projects.size).toBe(0);
  });
});

describe('delete_project', () => {
  it('deletes the project; deleting again reports not-found', async () => {
    const { baseUrl } = await startTestApi();
    const client = await connectMcpClient(new HttpProjectsApi(baseUrl));

    const id = createdId(await callTool(client, 'create_project', { name: 'Doomed', state: validState() }));

    const result = await callTool(client, 'delete_project', { id });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ id, deleted: true });

    const refetched = await fetch(`${baseUrl}/api/projects/${id}`);
    expect(refetched.status).toBe(404);

    const text = await expectError(callTool(client, 'delete_project', { id }));
    expect(text).toContain(`Project not found: ${id}`);
  });

  it('rejects a missing id before issuing any request', async () => {
    const { baseUrl, projects } = await startTestApi();
    const client = await connectMcpClient(new HttpProjectsApi(baseUrl));

    const text = await expectError(callTool(client, 'delete_project'));
    expect(text).toContain('id must be a non-empty string');
    expect(projects.size).toBe(0);
  });
});

describe('failure surfacing', () => {
  it('reports an unreachable API as an error result with a recovery hint', async () => {
    const client = await connectMcpClient(new HttpProjectsApi('http://127.0.0.1:1'));

    const text = await expectError(
      callTool(client, 'create_project', { name: 'X', state: validState() }),
    );
    expect(text).toContain('Syncro API unavailable');
    expect(text).toContain('npm run server:start');
  });

  it('names the available tools for an unknown tool call', async () => {
    const { baseUrl } = await startTestApi();
    const client = await connectMcpClient(new HttpProjectsApi(baseUrl));

    const text = await expectError(callTool(client, 'no_such_tool'));
    expect(text).toContain('Unknown tool: no_such_tool');
    expect(text).toContain('create_project, update_project, delete_project');
  });
});
