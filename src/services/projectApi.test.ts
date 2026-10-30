import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptionStyle } from '../types';
import {
  ApiError,
  createProject,
  deleteProject,
  getMediaUrl,
  getProject,
  listProjects,
  updateProject,
  uploadMedia,
  type ProjectRecord,
  type ProjectStatePayload,
  type ProjectSummary,
} from './projectApi';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function lastFetchCall(): { url: string; init: RequestInit } {
  const calls = fetchMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const [url, init] = calls[calls.length - 1];
  return { url: url as string, init: init as RequestInit };
}

const CAPTION_STYLE: CaptionStyle = {
  mode: 'lower-third',
  fontSize: 24,
  color: '#ffffff',
  bgColor: '#000000',
  position: 'bottom',
};

const STATE: ProjectStatePayload = {
  clips: [{ id: 'c1', name: 'intro.mp4', duration: 5, startTime: 0 }],
  voiceover: {
    duration: 5,
    transcription: 'hello',
    segments: [{ text: 'hello', start: 0, end: 2 }],
  },
  captionStyle: CAPTION_STYLE,
  captionsEnabled: true,
};

const RECORD: ProjectRecord = {
  id: 'p1',
  name: 'Launch video',
  createdAt: '2026-10-30T10:00:00.000Z',
  updatedAt: '2026-10-30T11:00:00.000Z',
  state: STATE,
};

const SUMMARY: ProjectSummary = {
  id: 'p1',
  name: 'Launch video',
  createdAt: RECORD.createdAt,
  updatedAt: RECORD.updatedAt,
};

describe('listProjects', () => {
  it('GETs the projects endpoint and returns the parsed list', async () => {
    fetchMock.mockResolvedValue(jsonResponse([SUMMARY]));

    const result = await listProjects();

    expect(result).toEqual([SUMMARY]);
    const { url, init } = lastFetchCall();
    expect(url).toBe('/api/projects');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('honors a custom baseUrl option', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await listProjects({ baseUrl: 'http://localhost:3001/api' });

    expect(lastFetchCall().url).toBe('http://localhost:3001/api/projects');
  });

  it('throws ApiError when the list payload is not an array of projects', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ nope: true }]));

    await expect(listProjects()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'invalid_response',
      status: 200,
    });
  });
});

describe('getProject', () => {
  it('GETs the encoded project id and returns the record', async () => {
    fetchMock.mockResolvedValue(jsonResponse(RECORD));

    const result = await getProject('a b/c');

    expect(result).toEqual(RECORD);
    expect(lastFetchCall().url).toBe('/api/projects/a%20b%2Fc');
  });
});

describe('createProject', () => {
  it('POSTs the name and state as JSON and returns the record', async () => {
    fetchMock.mockResolvedValue(jsonResponse(RECORD));

    const result = await createProject('Launch video', STATE);

    expect(result).toEqual(RECORD);
    const { url, init } = lastFetchCall();
    expect(url).toBe('/api/projects');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'Launch video', state: STATE }));
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
  });
});

describe('updateProject', () => {
  it('PUTs only the patch fields as JSON and returns the record', async () => {
    fetchMock.mockResolvedValue(jsonResponse(RECORD));

    const result = await updateProject('p1', { name: 'Renamed' });

    expect(result).toEqual(RECORD);
    const { url, init } = lastFetchCall();
    expect(url).toBe('/api/projects/p1');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ name: 'Renamed' }));
  });
});

describe('deleteProject', () => {
  it('DELETEs and resolves on a 204 with no body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(deleteProject('p1')).resolves.toBeUndefined();

    const { url, init } = lastFetchCall();
    expect(url).toBe('/api/projects/p1');
    expect(init.method).toBe('DELETE');
  });

  it('also resolves on a 200 with an empty body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await expect(deleteProject('p1')).resolves.toBeUndefined();
  });
});

describe('uploadMedia', () => {
  it('POSTs multipart form data and returns the upload result', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'm1', url: '/api/media/m1' }));
    const file = new File(['media bytes'], 'clip.mp4', { type: 'video/mp4' });

    const result = await uploadMedia(file);

    expect(result).toEqual({ id: 'm1', url: '/api/media/m1' });
    const { url, init } = lastFetchCall();
    expect(url).toBe('/api/media');
    expect(init.method).toBe('POST');
    expect(init.headers).toBeUndefined();
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    // undici's FormData may return a copy of the stored File — assert by value.
    const stored = form.get('file');
    expect(stored).toBeInstanceOf(File);
    expect((stored as File).name).toBe('clip.mp4');
    expect((stored as File).type).toBe('video/mp4');
    expect((stored as File).size).toBe(file.size);
  });

  it('throws ApiError when the upload payload is malformed', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ unrelated: true }));

    await expect(uploadMedia(new File(['x'], 'a.mp4'))).rejects.toMatchObject({
      name: 'ApiError',
      code: 'invalid_response',
    });
  });
});

describe('getMediaUrl', () => {
  it('builds the media URL from the default base', () => {
    expect(getMediaUrl('m1')).toBe('/api/media/m1');
  });

  it('encodes ids and honors a custom base without a trailing slash', () => {
    expect(getMediaUrl('a b', { baseUrl: 'http://host:3001/api/' })).toBe(
      'http://host:3001/api/media/a%20b'
    );
  });
});

describe('error normalization', () => {
  it('surfaces a JSON error message and status on failure', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message: 'Project not found' }, { status: 404, statusText: 'Not Found' })
    );

    const err = await getProject('p1').catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(404);
    expect(err.message).toBe('Project not found');
    expect(err.code).toBe('http_error');
    expect(err.url).toBe('/api/projects/p1');
  });

  it('prefers the server-provided code when present', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'db corrupt', code: 'SQLITE_CORRUPT' }, { status: 500 })
    );

    await expect(listProjects()).rejects.toMatchObject({
      status: 500,
      code: 'SQLITE_CORRUPT',
      message: 'db corrupt',
    });
  });

  it('falls back to the status line on non-JSON error bodies (no HTML leak)', async () => {
    fetchMock.mockResolvedValue(
      new Response('<!doctype html><html><body>404 page</body></html>', {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'content-type': 'text/html' },
      })
    );

    await expect(listProjects()).rejects.toMatchObject({
      status: 500,
      code: 'http_error',
      message: 'Request failed with status 500 Internal Server Error',
    });
  });

  it('wraps network failures in ApiError with status 0 and preserves the cause', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const err = await listProjects().catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.code).toBe('network_error');
    expect(err.message).toBe('Network request failed: Failed to fetch');
    expect(err.cause).toBeInstanceOf(TypeError);
  });

  it('wraps a malformed 2xx JSON body as invalid_response', async () => {
    fetchMock.mockResolvedValue(
      new Response('}{ garbage', { status: 200, headers: { 'content-type': 'application/json' } })
    );

    await expect(listProjects()).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
      name: 'ApiError',
    });
  });

  it('passes caller aborts through unwrapped', async () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValue(abort);

    await expect(listProjects()).rejects.toBe(abort);
  });

  it('propagates the abort signal to fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const controller = new AbortController();

    await listProjects({ signal: controller.signal });

    expect(lastFetchCall().init.signal).toBe(controller.signal);
  });
});
