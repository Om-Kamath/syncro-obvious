import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { SyncroApiClient, type FetchLike, type ProjectRecord, type SerializedClip } from './apiClient';
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  createSyncroMcpServer,
  parseMaxUploadBytes,
} from './mediaTools';

/** Connect a real MCP client to a fresh tool server over an in-memory transport pair. */
async function connectTools(fetchImpl: FetchLike, maxUploadBytes: number = DEFAULT_MAX_UPLOAD_BYTES): Promise<Client> {
  const apiClient = new SyncroApiClient({ baseUrl: 'http://syncro.test', fetch: fetchImpl });
  const server = createSyncroMcpServer({ apiClient, maxUploadBytes });
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

/** Parse the JSON payload of a successful result; throws on error results so misuse is loud. */
function jsonPayload(result: CallToolResult): Record<string, unknown> {
  if (result.isError) throw new Error(`expected a successful tool result, got: ${resultText(result)}`);
  return JSON.parse(resultText(result)) as Record<string, unknown>;
}

interface CallRecord {
  url: string;
  init?: RequestInit;
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): {
  fetch: FetchLike;
  calls: CallRecord[];
} {
  const calls: CallRecord[] = [];
  return {
    calls,
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      return handler(url, init);
    },
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Shaped like the real `POST /api/media` 201: MediaMetadata body + Location header. */
function uploadResponse(id: string, size = 11): Response {
  return jsonResponse(
    201,
    { id, filename: 'intro.mp4', mimeType: 'video/mp4', size, createdAt: '2026-10-30T00:00:00.000Z' },
    { Location: `/api/media/${id}` },
  );
}

function clipFixture(overrides: Partial<SerializedClip> = {}): SerializedClip {
  return { id: 'clip-1', name: 'intro.mp4', duration: 5, startTime: 0, ...overrides };
}

function projectFixture(clips: SerializedClip[] = []): ProjectRecord {
  return {
    id: 'proj-1',
    name: 'Launch Video',
    state: {
      clips,
      voiceover: null,
      captionStyle: { mode: 'lower-third', fontSize: 24, color: '#ffffff', bgColor: '#00000080', position: 'bottom' },
      captionsEnabled: false,
    },
  };
}

/** Project server mock: GET/PUT /api/projects/proj-1, uploads get an id. */
function projectServer(project: ProjectRecord): MockFetch {
  return mockFetch((url, init) => {
    if (url.endsWith('/api/media')) return uploadResponse('med-new');
    if (url.endsWith('/api/projects/proj-1') && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { name: string; state: ProjectRecord['state'] };
      return jsonResponse(200, { ...project, name: body.name, state: body.state });
    }
    if (url.endsWith('/api/projects/proj-1')) return jsonResponse(200, project);
    return jsonResponse(404, { error: `Not found: ${url}` });
  });
}

type MockFetch = ReturnType<typeof mockFetch>;

describe('upload_media', () => {
  it('uploads bytes with a guessed content type and returns the media asset', async () => {
    const mock = mockFetch(() => uploadResponse('med-1'));
    const client = await connectTools(mock.fetch);
    const result = await callTool(client, 'upload_media', {
      bytes: Buffer.from('hello video').toString('base64'),
      filename: 'intro.mp4',
    });
    const payload = jsonPayload(result);

    expect(result.isError).toBeFalsy();
    expect(payload.ok).toBe(true);
    expect(payload.id).toBe('med-1');
    expect(payload.url).toBe('/api/media/med-1');
    expect(payload.size).toBe(11);
    expect(payload.mimeType).toBe('video/mp4');

    expect(mock.calls).toHaveLength(1);
    const { url, init } = mock.calls[0];
    expect(url).toBe('http://syncro.test/api/media?filename=intro.mp4');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('video/mp4');
    expect(new Uint8Array(init?.body as ArrayBufferLike)).toEqual(new Uint8Array(Buffer.from('hello video')));
  });

  it('uploads a file from disk, defaulting the filename to the basename', async () => {
    // Echo the requested filename back, like the real media API would.
    const mock = mockFetch((url) => {
      const filename = new URL(url).searchParams.get('filename') ?? 'intro.mp4';
      return jsonResponse(
        201,
        { id: 'med-2', filename, mimeType: 'video/webm', size: 5, createdAt: '2026-10-30T00:00:00.000Z' },
        { Location: '/api/media/med-2' },
      );
    });
    const client = await connectTools(mock.fetch);
    const dir = await mkdtemp(join(tmpdir(), 'syncro-mcp-'));
    const filePath = join(dir, 'clip.webm');
    const fileBytes = new Uint8Array([9, 8, 7, 6, 5]);
    await writeFile(filePath, fileBytes);

    const result = await callTool(client, 'upload_media', { path: filePath });
    const payload = jsonPayload(result);

    expect(result.isError).toBeFalsy();
    expect(payload.filename).toBe('clip.webm');
    const { url, init } = mock.calls[0];
    expect(url).toBe('http://syncro.test/api/media?filename=clip.webm');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('video/webm');
    expect(new Uint8Array(init?.body as ArrayBufferLike)).toEqual(fileBytes);
  });

  it('passes an explicit contentType through to the API and sends no project param', async () => {
    const mock = mockFetch(() => uploadResponse('med-3'));
    const client = await connectTools(mock.fetch);
    await callTool(client, 'upload_media', {
      bytes: Buffer.from('x').toString('base64'),
      contentType: 'video/quicktime',
    });

    const { url, init } = mock.calls[0];
    expect(url).toBe('http://syncro.test/api/media');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('video/quicktime');
  });

  it('rejects when both path and bytes are given, without contacting the server', async () => {
    const mock = mockFetch(() => uploadResponse('med-x'));
    const client = await connectTools(mock.fetch);
    const result = await callTool(client, 'upload_media', {
      path: '/tmp/video.mp4',
      bytes: Buffer.from('x').toString('base64'),
    });
    const text = resultText(result);

    expect(result.isError).toBe(true);
    expect(text).toContain('exactly one');
    expect(mock.calls).toHaveLength(0);
  });

  it('rejects when neither path nor bytes are given', async () => {
    const mock = mockFetch(() => uploadResponse('med-x'));
    const client = await connectTools(mock.fetch);
    const result = await callTool(client, 'upload_media', { filename: 'orphan.mp4' });

    expect(result.isError).toBe(true);
    expect(mock.calls).toHaveLength(0);
  });

  it('reports an oversized bytes payload without contacting the server', async () => {
    const mock = mockFetch(() => uploadResponse('med-x'));
    const client = await connectTools(mock.fetch, 8);
    const result = await callTool(client, 'upload_media', {
      bytes: Buffer.from('way more than eight bytes').toString('base64'),
    });
    const text = resultText(result);

    expect(result.isError).toBe(true);
    expect(text).toContain('Media too large');
    expect(text).toContain('25 bytes exceeds the 8-byte upload limit');
    expect(mock.calls).toHaveLength(0);
  });

  it('reports an oversized file from disk before reading or uploading it', async () => {
    const mock = mockFetch(() => uploadResponse('med-x'));
    const client = await connectTools(mock.fetch, 10);
    const dir = await mkdtemp(join(tmpdir(), 'syncro-mcp-'));
    const filePath = join(dir, 'big.mp4');
    await writeFile(filePath, new Uint8Array(20).fill(1));

    const result = await callTool(client, 'upload_media', { path: filePath });
    const text = resultText(result);

    expect(result.isError).toBe(true);
    expect(text).toContain('Media too large');
    expect(text).toContain('20 bytes exceeds the 10-byte upload limit');
    expect(mock.calls).toHaveLength(0);
  });

  it('reports invalid base64 without contacting the server', async () => {
    const mock = mockFetch(() => uploadResponse('med-x'));
    const client = await connectTools(mock.fetch);
    const result = await callTool(client, 'upload_media', { bytes: 'not base64!!' });
    const text = resultText(result);

    expect(result.isError).toBe(true);
    expect(text).toContain('not valid base64');
    expect(mock.calls).toHaveLength(0);
  });

  it('reports unreadable files as tool errors', async () => {
    const mock = mockFetch(() => uploadResponse('med-x'));
    const client = await connectTools(mock.fetch);
    const result = await callTool(client, 'upload_media', { path: '/nonexistent/dir/video.mp4' });
    const text = resultText(result);

    expect(result.isError).toBe(true);
    expect(text).toContain('File not readable');
  });

  it('surfaces server errors as tool errors', async () => {
    const mock = mockFetch(() => jsonResponse(500, { error: 'disk full' }));
    const client = await connectTools(mock.fetch);
    const result = await callTool(client, 'upload_media', {
      bytes: Buffer.from('x').toString('base64'),
    });
    const text = resultText(result);

    expect(result.isError).toBe(true);
    expect(text).toContain('status 500');
    expect(text).toContain('disk full');
  });

  it('surfaces network failures as tool errors', async () => {
    const mock = mockFetch(() => {
      throw new TypeError('fetch failed');
    });
    const client = await connectTools(mock.fetch);
    const result = await callTool(client, 'upload_media', {
      bytes: Buffer.from('x').toString('base64'),
    });

    // The SDK converts a thrown callback into an isError result, so the
    // session stays alive; the agent sees the failure either way.
    expect(result.isError).toBe(true);
  });
});

describe('attach_media', () => {
  it('appends a clip chained to the end of the timeline and saves the project', async () => {
    const project = projectFixture([clipFixture(), clipFixture({ id: 'clip-2', name: 'b.mp4', startTime: 5 })]);
    const mock = projectServer(project);
    const client = await connectTools(mock.fetch);
    const result = await callTool(client, 'attach_media', {
      projectId: 'proj-1',
      mediaId: 'med-new',
      target: 'clip',
      duration: 12.5,
    });
    const payload = jsonPayload(result);

    expect(result.isError).toBeFalsy();
    expect(payload.ok).toBe(true);
    expect(payload.clipCount).toBe(3);

    const put = mock.calls.find((c) => c.init?.method === 'PUT');
    expect(put).toBeDefined();
    expect(put?.url).toBe('http://syncro.test/api/projects/proj-1');
    const body = JSON.parse(String(put?.init?.body)) as { name: string; state: ProjectRecord['state'] };
    expect(body.name).toBe('Launch Video');
    expect(body.state.clips).toHaveLength(3);
    // Earlier clips untouched; new clip chained after the last one.
    expect(body.state.clips.slice(0, 2)).toEqual(project.state.clips);
    expect(body.state.clips[2]).toMatchObject({ name: 'media-med-new', duration: 12.5, startTime: 10 });
    // The attached clip in the tool result carries the same values.
    const attached = payload.clip as { name: string; startTime: number };
    expect(attached.name).toBe('media-med-new');
    expect(attached.startTime).toBe(10);
  });

  it('chains after a trimmed clip using its effective duration', async () => {
    const project = projectFixture([clipFixture({ duration: 30, trimmedDuration: 4 })]);
    const mock = projectServer(project);
    const client = await connectTools(mock.fetch);
    await callTool(client, 'attach_media', {
      projectId: 'proj-1',
      mediaId: 'med-new',
      target: 'clip',
      duration: 7,
    });

    const put = mock.calls.find((c) => c.init?.method === 'PUT');
    const body = JSON.parse(String(put?.init?.body)) as { state: ProjectRecord['state'] };
    expect(body.state.clips[1].startTime).toBe(4);
  });

  it('honors explicit name, startTime, and track', async () => {
    const mock = projectServer(projectFixture());
    const client = await connectTools(mock.fetch);
    const payload = jsonPayload(
      await callTool(client, 'attach_media', {
        projectId: 'proj-1',
        mediaId: 'med-new',
        target: 'clip',
        duration: 3,
        name: 'B-roll',
        startTime: 1.5,
        track: 2,
      }),
    );

    const attached = payload.clip as { name: string; startTime: number; track: number };
    expect(attached.name).toBe('B-roll');
    expect(attached.startTime).toBe(1.5);
    expect(attached.track).toBe(2);
  });

  it('sets the project voiceover and leaves clips untouched', async () => {
    const project = projectFixture([clipFixture()]);
    const mock = projectServer(project);
    const client = await connectTools(mock.fetch);
    const result = await callTool(client, 'attach_media', {
      projectId: 'proj-1',
      mediaId: 'med-voice',
      target: 'voiceover',
      duration: 9,
      transcription: 'Welcome back to the channel.',
    });
    const payload = jsonPayload(result);

    expect(result.isError).toBeFalsy();
    expect(payload.ok).toBe(true);
    const put = mock.calls.find((c) => c.init?.method === 'PUT');
    const body = JSON.parse(String(put?.init?.body)) as { state: ProjectRecord['state'] };
    expect(body.state.voiceover).toEqual({ duration: 9, transcription: 'Welcome back to the channel.' });
    expect(body.state.clips).toEqual(project.state.clips);
  });

  it('reports missing projects as tool errors', async () => {
    const mock = mockFetch(() => jsonResponse(404, { error: 'Project not found: nope' }));
    const client = await connectTools(mock.fetch);
    const result = await callTool(client, 'attach_media', {
      projectId: 'nope',
      mediaId: 'med-new',
      target: 'clip',
      duration: 3,
    });
    const text = resultText(result);

    expect(result.isError).toBe(true);
    expect(text).toContain('status 404');
    expect(text).toContain('Project not found: nope');
  });

  it('reports failed saves as tool errors', async () => {
    const project = projectFixture();
    const mock = mockFetch((url, init) => {
      if (init?.method === 'PUT') return jsonResponse(500, { error: 'write failed' });
      if (url.endsWith('/api/projects/proj-1')) return jsonResponse(200, project);
      return jsonResponse(404, { error: `Not found: ${url}` });
    });
    const client = await connectTools(mock.fetch);
    const result = await callTool(client, 'attach_media', {
      projectId: 'proj-1',
      mediaId: 'med-new',
      target: 'clip',
      duration: 3,
    });
    const text = resultText(result);

    expect(result.isError).toBe(true);
    expect(text).toContain('write failed');
  });
});

describe('tool registry', () => {
  it('lists both media tools with schemas', async () => {
    const mock = mockFetch(() => uploadResponse('med-x'));
    const client = await connectTools(mock.fetch);
    const { tools } = await client.listTools();

    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual(['attach_media', 'upload_media']);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});

describe('parseMaxUploadBytes', () => {
  it('accepts positive integers', () => {
    expect(parseMaxUploadBytes('1024')).toBe(1024);
    expect(parseMaxUploadBytes(' 2048 ')).toBe(2048);
  });

  it('rejects missing or invalid values so the caller can fall back', () => {
    expect(parseMaxUploadBytes(undefined)).toBeNull();
    expect(parseMaxUploadBytes('')).toBeNull();
    expect(parseMaxUploadBytes('abc')).toBeNull();
    expect(parseMaxUploadBytes('-5')).toBeNull();
    expect(parseMaxUploadBytes('0')).toBeNull();
    expect(parseMaxUploadBytes('1.5')).toBeNull();
  });
});
