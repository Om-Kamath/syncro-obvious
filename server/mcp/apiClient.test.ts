import { describe, expect, it } from 'vitest';
import {
  SyncroApiClient,
  SyncroApiError,
  guessMimeFromFilename,
  type ProjectRecord,
  type SyncroApiClientOptions,
} from './apiClient';

type CallRecord = { url: string; init?: RequestInit };

interface MockFetch {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  calls: CallRecord[];
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): MockFetch {
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

function client(mock: MockFetch): SyncroApiClient {
  return new SyncroApiClient({ baseUrl: 'http://syncro.test/', fetch: mock.fetch } satisfies SyncroApiClientOptions);
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const CAPTION_STYLE = {
  mode: 'lower-third',
  fontSize: 24,
  color: '#ffffff',
  bgColor: '#00000080',
  position: 'bottom',
} as const;

function projectFixture(clips: ProjectRecord['state']['clips'] = []): ProjectRecord {
  return {
    id: 'proj-1',
    name: 'Launch Video',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    state: { clips, voiceover: null, captionStyle: { ...CAPTION_STYLE }, captionsEnabled: false },
  };
}

describe('guessMimeFromFilename', () => {
  it('maps known extensions, case-insensitively', () => {
    expect(guessMimeFromFilename('clip.MP4')).toBe('video/mp4');
    expect(guessMimeFromFilename('song.wav')).toBe('audio/wav');
    expect(guessMimeFromFilename('thumb.webp')).toBe('image/webp');
  });

  it('falls back to octet-stream for unknown or missing names', () => {
    expect(guessMimeFromFilename('video.xyz')).toBe('application/octet-stream');
    expect(guessMimeFromFilename(undefined)).toBe('application/octet-stream');
  });
});

describe('SyncroApiClient.uploadMedia', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);

  it('POSTs raw bytes to /api/media with the filename query param and content type', async () => {
    const mock = mockFetch(() =>
      jsonResponse(
        201,
        {
          id: 'med-1',
          filename: 'intro.mp4',
          mimeType: 'video/mp4',
          size: 4,
          createdAt: '2026-10-30T00:00:00.000Z',
        },
        { Location: '/api/media/med-1' },
      ),
    );
    const asset = await client(mock).uploadMedia({
      bytes,
      filename: 'intro.mp4',
      contentType: 'video/mp4',
    });

    expect(mock.calls).toHaveLength(1);
    const { url, init } = mock.calls[0];
    expect(url).toBe('http://syncro.test/api/media?filename=intro.mp4');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('video/mp4');
    expect(init?.body).toEqual(bytes);
    expect(asset).toEqual({
      id: 'med-1',
      url: '/api/media/med-1',
      filename: 'intro.mp4',
      mimeType: 'video/mp4',
      size: 4,
      createdAt: '2026-10-30T00:00:00.000Z',
    });
  });

  it('derives /api/media/:id from the id when the server omits Location and defaults the content type', async () => {
    const mock = mockFetch(() => jsonResponse(201, { id: 'med-2' }));
    const asset = await client(mock).uploadMedia({ bytes });

    expect(asset.url).toBe('/api/media/med-2');
    const { url, init } = mock.calls[0];
    expect(url).toBe('http://syncro.test/api/media');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/octet-stream');
  });

  it('throws SyncroApiError with the server error message', async () => {
    const mock = mockFetch(() => jsonResponse(413, { error: 'payload too large' }));
    const error = await client(mock).uploadMedia({ bytes }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SyncroApiError);
    expect((error as SyncroApiError).status).toBe(413);
    expect((error as SyncroApiError).message).toBe('payload too large');
  });

  it('throws a descriptive error for non-JSON error bodies', async () => {
    const mock = mockFetch(() => new Response('gateway timeout', { status: 504 }));
    const error = await client(mock).uploadMedia({ bytes }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SyncroApiError);
    expect((error as SyncroApiError).message).toContain('non-JSON');
  });

  it('throws when the success response has no media id', async () => {
    const mock = mockFetch(() => jsonResponse(200, { unexpected: true }));
    const error = await client(mock).uploadMedia({ bytes }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SyncroApiError);
    expect((error as SyncroApiError).message).toContain('missing an id');
  });
});

describe('SyncroApiClient.getProject', () => {
  it('GETs the project and maps the record', async () => {
    const project = projectFixture();
    const mock = mockFetch((url) => (url.endsWith('/api/projects/proj-1') ? jsonResponse(200, project) : jsonResponse(404, {})));
    const record = await client(mock).getProject('proj-1');

    expect(mock.calls[0].url).toBe('http://syncro.test/api/projects/proj-1');
    expect(record.id).toBe('proj-1');
    expect(record.name).toBe('Launch Video');
    expect(record.state.clips).toEqual([]);
  });

  it('encodes the project id', async () => {
    const mock = mockFetch(() => jsonResponse(200, projectFixture()));
    await client(mock).getProject('a/b');
    expect(mock.calls[0].url).toBe('http://syncro.test/api/projects/a%2Fb');
  });

  it('propagates 404 as SyncroApiError', async () => {
    const mock = mockFetch(() => jsonResponse(404, { error: 'Project not found: nope' }));
    const error = await client(mock).getProject('nope').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SyncroApiError);
    expect((error as SyncroApiError).status).toBe(404);
    expect((error as SyncroApiError).message).toBe('Project not found: nope');
  });
});

describe('SyncroApiClient.updateProject', () => {
  it('PUTs the { name, state } payload and maps the record', async () => {
    const project = projectFixture();
    const state = { ...project.state, captionsEnabled: true };
    const mock = mockFetch((url, init) =>
      url.endsWith('/api/projects/proj-1') && init?.method === 'PUT' ? jsonResponse(200, project) : jsonResponse(404, {}),
    );
    const record = await client(mock).updateProject('proj-1', { name: project.name, state });

    expect(record.id).toBe('proj-1');
    const { init } = mock.calls[0];
    expect(init?.method).toBe('PUT');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'Launch Video', state });
  });

  it('propagates server errors with the JSON message', async () => {
    const mock = mockFetch(() => jsonResponse(400, { error: 'state.clips must be an array' }));
    const project = projectFixture();
    const error = await client(mock)
      .updateProject('proj-1', { name: project.name, state: project.state })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SyncroApiError);
    expect((error as SyncroApiError).status).toBe(400);
    expect((error as SyncroApiError).message).toBe('state.clips must be an array');
  });
});
