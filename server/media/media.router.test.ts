import { Buffer } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const MAX_UPLOAD_BYTES = 256;

describe('media API (mounted at /api/media)', () => {
  let rootDir: string;

  beforeAll(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'syncro-media-api-'));
  });

  afterAll(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  function app() {
    return createApp({ media: { rootDir, maxUploadBytes: MAX_UPLOAD_BYTES } });
  }

  interface Uploaded {
    id: string;
    size: number;
  }

  async function upload(body: Buffer, contentType = 'application/octet-stream'): Promise<Uploaded> {
    const res = await request(app()).post('/api/media').set('Content-Type', contentType).send(body);
    expect(res.status).toBe(201);
    return { id: res.body.id as string, size: res.body.size as number };
  }

  it('POST stores a blob and returns its metadata', async () => {
    const payload = Buffer.from([1, 2, 3, 4]);
    const res = await request(app())
      .post('/api/media')
      .set('Content-Type', 'video/mp4')
      .set('X-Filename', 'clip.mp4')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/media/${res.body.id}`);
    expect(res.body).toMatchObject({
      filename: 'clip.mp4',
      mimeType: 'video/mp4',
      size: payload.length,
    });
    expect(typeof res.body.createdAt).toBe('string');
  });

  it('upload → ranged GET returns the exact byte slice', async () => {
    const payload = Buffer.from('0123456789', 'utf8');
    const { id } = await upload(payload, 'application/octet-stream');

    const res = await request(app()).get(`/api/media/${id}`).set('Range', 'bytes=2-5');

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 2-5/${payload.length}`);
    expect(res.headers['content-length']).toBe('4');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(Buffer.from(res.body).equals(Buffer.from('2345'))).toBe(true);
  });

  it('GET without a Range header serves the full representation', async () => {
    const payload = Buffer.from('hello world', 'utf8');
    const { id, size } = await upload(payload);

    const res = await request(app()).get(`/api/media/${id}`);

    expect(res.status).toBe(200);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe(String(size));
    expect(Buffer.from(res.body).equals(payload)).toBe(true);
  });

  it('open-ended range serves from the offset to the end', async () => {
    const { id } = await upload(Buffer.from('hello world'));
    const res = await request(app()).get(`/api/media/${id}`).set('Range', 'bytes=6-');
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 6-10/11');
    expect(Buffer.from(res.body).toString('utf8')).toBe('world');
  });

  it('suffix range serves the final N bytes', async () => {
    const { id } = await upload(Buffer.from('hello world'));
    const res = await request(app()).get(`/api/media/${id}`).set('Range', 'bytes=-5');
    expect(res.status).toBe(206);
    expect(Buffer.from(res.body).toString('utf8')).toBe('world');
  });

  it('an end beyond the size clamps to the last byte', async () => {
    const { id } = await upload(Buffer.from('hello world'));
    const res = await request(app()).get(`/api/media/${id}`).set('Range', 'bytes=8-999');
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 8-10/11');
    expect(Buffer.from(res.body).toString('utf8')).toBe('rld');
  });

  it('an unsatisfiable range responds 416 with the representation size', async () => {
    const { id } = await upload(Buffer.from('hello world'));
    const res = await request(app()).get(`/api/media/${id}`).set('Range', 'bytes=99-');
    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */11');
  });

  it('a malformed range falls back to the full representation', async () => {
    const payload = Buffer.from('hello world');
    const { id } = await upload(payload);
    const res = await request(app()).get(`/api/media/${id}`).set('Range', 'bytes=zzz');
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).equals(payload)).toBe(true);
  });

  it('content-type and disposition round-trip with the stored metadata', async () => {
    const payload = Buffer.from('frame-bytes');
    const res = await request(app())
      .post('/api/media')
      .set('Content-Type', 'video/mp4')
      .query({ filename: 'shot 1.mp4' })
      .send(payload);
    const { id } = res.body as { id: string };

    const get = await request(app()).get(`/api/media/${id}`);
    expect(get.headers['content-type']).toBe('video/mp4');
    expect(get.headers['content-disposition']).toBe('inline; filename="shot 1.mp4"');
  });

  it('HEAD reports the same headers without a body', async () => {
    const payload = Buffer.from('hello world');
    const { id, size } = await upload(payload);

    const res = await request(app()).head(`/api/media/${id}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(size));
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.text ?? '').toBe('');
  });

  it('GET an unknown id responds 404', async () => {
    const res = await request(app()).get('/api/media/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe('string');
  });

  it('a path-traversal id responds 404, not a server error', async () => {
    const res = await request(app()).get('/api/media/..%2F..%2Fetc%2Fpasswd');
    expect(res.status).toBe(404);
  });

  it('rejects uploads over the size cap with 413', async () => {
    const res = await request(app())
      .post('/api/media')
      .set('Content-Type', 'video/mp4')
      .send(Buffer.alloc(MAX_UPLOAD_BYTES + 1));

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/byte limit/);
  });

  it('stores mislabeled JSON bodies as raw bytes instead of parsing them', async () => {
    const raw = '{"not-parsed":';
    const res = await request(app()).post('/api/media').set('Content-Type', 'application/json').send(raw);

    // express.json() would 400 on malformed JSON — 201 proves the media router
    // consumed the body raw.
    expect(res.status).toBe(201);
    expect(res.body.size).toBe(Buffer.byteLength(raw));
  });

  it('zero-byte blobs store and serve with Content-Length 0', async () => {
    const { id } = await upload(Buffer.alloc(0));

    const res = await request(app()).get(`/api/media/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe('0');
  });
});
