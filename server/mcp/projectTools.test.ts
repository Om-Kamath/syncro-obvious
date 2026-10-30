import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SyncroApiClient } from './apiClient';
import type { ProjectRecord, SerializedClip, SerializedVoiceover } from './apiClient';
import { DEFAULT_MAX_UPLOAD_BYTES, createSyncroMcpServer } from './mediaTools';
import type { ProjectStatePayload } from './apiClient';

/**
 * Tool-call tests for the project mutation tools against a test server:
 * every test drives a real MCP client (in-memory transport) through the
 * real `createSyncroMcpServer` factory and the real `SyncroApiClient` into a
 * real express server implementing the projects REST contract on an
 * ephemeral port. No fetch mocking at the tool layer — failures surface
 * exactly as an agent would see them.
 */

type CloseFn = () => void;

const closeFns: CloseFn[] = [];

afterEach(() => {
  for (const close of closeFns) close();
  closeFns.length = 0;
});

/**
 * Minimal stand-in for the Syncro projects API: same routes, status codes,
 * and error-body shape as the wire contract in `src/services/projectApi.ts`
 * (`{ error }` on 404, 204 on delete), with an in-memory Map instead of
 * SQLite. The MCP layer's validation runs before any HTTP call, so payloads
 * reaching this server are already normalized.
 */
function startTestApi(): Promise<{ baseUrl: string; projects: Map<string, ProjectRecord> }> {
  const projects = new Map<string, ProjectRecord>();
  const app = express();
  app.use(express.json());

  app.post('/api/projects', (req, res) => {
    const { name, state } = req.body as { name: string; state: ProjectStatePayload };
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
    const { name, state } = req.body as { name: string; state: ProjectStatePayload };
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

/** Connect a real MCP client to the real server factory over an in-memory transport pair. */
async function connectMcpClient(baseUrl: string): Promise<Client> {
  const apiClient = new SyncroApiClient({ baseUrl });
  const server = createSyncroMcpServer({ apiClient, maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
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

function textOf(result: CallToolResult): string {
  const block = result.content[0] as { type: string; text?: string };
  if (block?.type !== 'text' || typeof block.text !== 'string') {
    throw new Error(`expected a text block, got: ${JSON.stringify(result.content)}`);
  }
  return block.text;
}

/** Parse the JSON payload of a successful result; throws on error results so misuse is loud. */
function payloadOf(result: CallToolResult): unknown {
  if (result.isError) throw new Error(`expected a successful tool result, got: ${textOf(result)}`);
  return JSON.parse(textOf(result)) as unknown;
}

async function expectError(call: Promise<CallToolResult>): Promise<string> {
  const result = await call;
  expect(result.isError).toBe(true);
  return textOf(result);
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

function validState(overrides: Partial<ProjectStatePayload> = {}): ProjectStatePayload {
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

async function createProject(client: Client, name: string): Promise<ProjectRecord> {
  return payloadOf(await callTool(client, 'create_project', { name, state: validState() })) as ProjectRecord;
}

describe('tools/list', () => {
  it('exposes the three project mutation tools alongside the media tools', async () => {
    const { baseUrl } = await startTestApi();
    const client = await connectMcpClient(baseUrl);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['create_project', 'update_project', 'delete_project']));

    const mine = tools.filter((tool) => ['create_project', 'update_project', 'delete_project'].includes(tool.name));
    expect(mine).toHaveLength(3);
    for (const tool of mine) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description).toBeTruthy();
    }
  });
});

describe('create_project', () => {
  it('creates a project through the API and returns the stored record', async () => {
    const { baseUrl, projects } = await startTestApi();
    const client = await connectMcpClient(baseUrl);

    const record = await createProject(client, 'Launch video');

    expect(record.id).toBeTruthy();
    expect(record.name).toBe('Launch video');
    expect(record.state).toEqual(validState());
    expect(record.createdAt).toBe(record.updatedAt);

    const stored = projects.get(record.id);
    expect(stored).toEqual(record);
  });

  it('normalizes an omitted voiceover to null and drops unknown clip keys', async () => {
    const { baseUrl, projects } = await startTestApi();
    const client = await connectMcpClient(baseUrl);

    const state = validState({
      voiceover: undefined,
      clips: [{ ...baseClip(), file: 'browser blob' } as unknown as SerializedClip],
    });
    const payload = payloadOf(await callTool(client, 'create_project', { name: 'Clean', state }));
    const record = payload as ProjectRecord;

    expect(record.state.voiceover).toBeNull();
    expect(record.state.clips[0]).toEqual(baseClip());

    const stored = projects.get(record.id);
    expect(stored?.state).toEqual(record.state);
  });

  it.each([
    { label: 'blank name', args: { name: '   ', state: validState() }, message: 'name must be a non-empty string' },
    { label: 'missing state', args: { name: 'X' }, message: '' },
    { label: 'negative clip duration', args: { name: 'X', state: validState({ clips: [baseClip({ duration: -1 })] }) }, message: 'clips[0].duration must be >= 0' },
    { label: 'unknown transition', args: { name: 'X', state: validState({ clips: [baseClip({ transitionIn: 'zoom' as never })] }) }, message: 'clips[0].transitionIn must be one of cut, fade, dissolve, wipe' },
    { label: 'unknown caption mode', args: { name: 'X', state: validState({ captionStyle: { mode: 'karaoke' as never, fontSize: 32, color: '#fff', bgColor: '#000', position: 'bottom' } }) }, message: 'captionStyle.mode must be one of lower-third, word-highlight, speaker-labeled' },
    { label: 'segment start after end', args: { name: 'X', state: validState({ voiceover: { duration: 10, segments: [{ text: 'a', start: 5, end: 4 }] } }) }, message: 'voiceover.segments[0].start must be <= voiceover.segments[0].end' },
    { label: 'word start after end', args: { name: 'X', state: validState({ voiceover: { duration: 10, segments: [{ text: 'a', start: 0, end: 1, words: [{ word: 'a', start: 1, end: 0 }] }] } }) }, message: 'voiceover.segments[0].words[0].start must be <= voiceover.segments[0].words[0].end' },
  ])('rejects $label without touching the API', async ({ args, message }) => {
    const { baseUrl, projects } = await startTestApi();
    const client = await connectMcpClient(baseUrl);

    const text = await expectError(callTool(client, 'create_project', args));
    if (message) expect(text).toContain(message);
    expect(projects.size).toBe(0);
  });
});

describe('update_project', () => {
  it('replaces name and state, and the API reflects the change', async () => {
    const { baseUrl } = await startTestApi();
    const client = await connectMcpClient(baseUrl);

    const created = await createProject(client, 'Before');

    const updatedState = validState({
      clips: [baseClip(), baseClip({ id: 'clip-2', name: 'outro.mp4', startTime: 10 })],
    });
    const payload = payloadOf(await callTool(client, 'update_project', { id: created.id, name: 'After', state: updatedState }));
    const record = payload as ProjectRecord;

    expect(record.name).toBe('After');
    expect(record.state.clips).toHaveLength(2);
    expect(record.updatedAt >= record.createdAt).toBe(true);

    // Read back over HTTP to verify server-side state.
    const refetched = await fetch(`${baseUrl}/api/projects/${created.id}`);
    expect(refetched.status).toBe(200);
    const stored = (await refetched.json()) as ProjectRecord;
    expect(stored.name).toBe('After');
    expect(stored.state.clips).toHaveLength(2);
  });

  it('rejects an unknown id with the API not-found error', async () => {
    const { baseUrl } = await startTestApi();
    const client = await connectMcpClient(baseUrl);

    const text = await expectError(
      callTool(client, 'update_project', { id: 'no-such-id', name: 'Ghost', state: validState() }),
    );
    expect(text).toContain('Project not found: no-such-id');
  });

  it('rejects a blank id before issuing any request', async () => {
    const { baseUrl, projects } = await startTestApi();
    const client = await connectMcpClient(baseUrl);

    const text = await expectError(callTool(client, 'update_project', { id: '  ', name: 'X', state: validState() }));
    expect(text).toContain('id must be a non-empty string');
    expect(projects.size).toBe(0);
  });

  it('rejects a missing id (schema-level) without touching the API', async () => {
    const { baseUrl, projects } = await startTestApi();
    const client = await connectMcpClient(baseUrl);

    await expectError(callTool(client, 'update_project', { name: 'X', state: validState() }));
    expect(projects.size).toBe(0);
  });
});

describe('delete_project', () => {
  it('deletes the project; deleting again reports not-found', async () => {
    const { baseUrl } = await startTestApi();
    const client = await connectMcpClient(baseUrl);

    const created = await createProject(client, 'Doomed');

    const payload = payloadOf(await callTool(client, 'delete_project', { id: created.id }));
    expect(payload).toEqual({ id: created.id, deleted: true });

    const refetched = await fetch(`${baseUrl}/api/projects/${created.id}`);
    expect(refetched.status).toBe(404);

    const text = await expectError(callTool(client, 'delete_project', { id: created.id }));
    expect(text).toContain(`Project not found: ${created.id}`);
  });

  it('rejects a blank id before issuing any request', async () => {
    const { baseUrl, projects } = await startTestApi();
    const client = await connectMcpClient(baseUrl);

    const text = await expectError(callTool(client, 'delete_project', { id: '' }));
    expect(text).toContain('id must be a non-empty string');
    expect(projects.size).toBe(0);
  });
});

describe('failure surfacing', () => {
  it('reports an unreachable API as an error result with a recovery hint', async () => {
    const client = await connectMcpClient('http://127.0.0.1:1');

    const text = await expectError(
      callTool(client, 'create_project', { name: 'X', state: validState() }),
    );
    expect(text).toContain('Syncro API unavailable');
    expect(text).toContain('npm run server:start');
  });

  it('reports an unknown tool call as an error result naming the tool', async () => {
    const { baseUrl } = await startTestApi();
    const client = await connectMcpClient(baseUrl);

    const text = await expectError(callTool(client, 'no_such_tool'));
    expect(text).toContain('no_such_tool');
    expect(text).toMatch(/not found/i);
  });
});
