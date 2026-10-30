import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaNotFoundError, MediaRequestError, fetchMediaBlob, uploadMediaBlob } from './mediaClient';

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

afterEach(() => {
  mockFetch.mockReset();
});

function okJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('uploadMediaBlob', () => {
  it('posts raw bytes with metadata headers and returns the parsed id', async () => {
    mockFetch.mockResolvedValueOnce(okJsonResponse({ id: 'media-1', size: 3 }));
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' });

    const result = await uploadMediaBlob(blob, 'my clip.webm');

    expect(result).toEqual({ id: 'media-1', size: 3 });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/media');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('video/webm');
    expect(headers['x-syncro-filename']).toBe(encodeURIComponent('my clip.webm'));
  });

  it('rejects an upload the server refused', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":"nope"}', { status: 413 }));
    const blob = new Blob([new Uint8Array([1])]);

    await expect(uploadMediaBlob(blob, 'big.bin', 'application/octet-stream'))
      .rejects.toMatchObject({ name: 'MediaRequestError', status: 413 });
  });

  it('rejects a malformed response that carries no id', async () => {
    mockFetch.mockResolvedValueOnce(okJsonResponse({ size: 3 }));

    await expect(uploadMediaBlob(new Blob([new Uint8Array([1])]), 'x.bin', 'application/octet-stream'))
      .rejects.toMatchObject({ name: 'MediaRequestError' });
  });
});

describe('fetchMediaBlob', () => {
  it('returns the blob on success', async () => {
    mockFetch.mockResolvedValueOnce(new Response(new Uint8Array([9, 8, 7]), { status: 200 }));

    const blob = await fetchMediaBlob('media-1');

    expect(blob.size).toBe(3);
    expect(mockFetch.mock.calls[0]?.[0]).toBe('/api/media/media-1');
  });

  it('maps a 404 to MediaNotFoundError', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":"not found"}', { status: 404 }));

    await expect(fetchMediaBlob('gone')).rejects.toBeInstanceOf(MediaNotFoundError);
  });

  it('maps other failures to MediaRequestError', async () => {
    mockFetch.mockResolvedValueOnce(new Response('boom', { status: 502 }));

    await expect(fetchMediaBlob('media-1')).rejects.toMatchObject({ name: 'MediaRequestError', status: 502 });
  });
});

describe('error classes', () => {
  it('keeps the media id in a MediaNotFoundError message', () => {
    const err = new MediaNotFoundError('abc');
    expect(err.status).toBe(404);
    expect(err.message).toContain('abc');
    expect(new MediaRequestError('oops', 500).status).toBe(500);
  });
});
