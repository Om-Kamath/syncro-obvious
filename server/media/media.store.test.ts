import { Readable } from 'node:stream';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MediaStore, sanitizeFilename, sanitizeMimeType } from './media.store';

describe('MediaStore', () => {
  let rootDir: string;
  let store: MediaStore;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'syncro-media-store-'));
    store = new MediaStore(rootDir, 1024);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('round-trips an uploaded stream through open()', async () => {
    const metadata = await store.save(Readable.from([Buffer.from([1, 2, 3])]), {
      filename: 'a.bin',
      mimeType: 'video/webm',
    });

    const media = await store.open(metadata.id);
    expect(media?.metadata).toMatchObject({ filename: 'a.bin', mimeType: 'video/webm', size: 3 });
    expect(media?.absolutePath).toContain(metadata.id);
  });

  it('streams multi-chunk bodies byte-for-byte into the blob file', async () => {
    const payload = Buffer.from('binary-bytes');
    const metadata = await store.save(Readable.from([payload, payload]), {});

    const media = await store.open(metadata.id);
    expect(media).not.toBeNull();
    const onDisk = await readFile(join(rootDir, `${metadata.id}.bin`));
    expect(onDisk.equals(Buffer.concat([payload, payload]))).toBe(true);
    expect(metadata.size).toBe(payload.length * 2);
  });

  it('enforces the size cap on streams with no declared length', async () => {
    const capped = new MediaStore(rootDir, 8);
    await expect(capped.save(Readable.from([Buffer.alloc(20)]), {})).rejects.toMatchObject({
      status: 413,
    });
  });

  it('a declared content-length over the cap fails before reading the body', async () => {
    await expect(store.save(Readable.from([]), { contentLength: 4096 })).rejects.toMatchObject({
      status: 413,
    });
  });

  it('rejects non-positive size caps at construction', () => {
    expect(() => new MediaStore(rootDir, 0)).toThrow(RangeError);
  });

  it('open() returns null for unknown and malformed ids', async () => {
    await store.save(Readable.from([Buffer.from('x')]), {});
    expect(await store.open('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await store.open('../../etc/passwd')).toBeNull();
    expect(await store.open('')).toBeNull();
  });

  it('a corrupt metadata sidecar surfaces as an error, not an empty result', async () => {
    const metadata = await store.save(Readable.from([Buffer.from('x')]), {});
    await writeFile(join(rootDir, `${metadata.id}.json`), '{corrupt', 'utf8');
    await expect(store.open(metadata.id)).rejects.toBeInstanceOf(SyntaxError);
  });

  describe('sanitizeFilename', () => {
    it('strips path components, control characters, and excess length', () => {
      expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
      expect(sanitizeFilename('C:\\Users\\om\\clip.mp4')).toBe('clip.mp4');
      expect(sanitizeFilename('clip\x00.mp4')).toBe('clip.mp4');
      expect(sanitizeFilename('  spaced name.webm ')).toBe('spaced name.webm');
      expect(sanitizeFilename('a'.repeat(500)).length).toBe(200);
    });

    it('falls back to "blob" for empty or dot-only names', () => {
      expect(sanitizeFilename(undefined)).toBe('blob');
      expect(sanitizeFilename('')).toBe('blob');
      expect(sanitizeFilename('.')).toBe('blob');
      expect(sanitizeFilename('..')).toBe('blob');
    });
  });

  describe('sanitizeMimeType', () => {
    it('keeps the bare lowercased media type and drops parameters', () => {
      expect(sanitizeMimeType('video/mp4; charset=binary')).toBe('video/mp4');
      expect(sanitizeMimeType('VIDEO/WebM')).toBe('video/webm');
    });

    it('defaults to application/octet-stream when absent or empty', () => {
      expect(sanitizeMimeType(undefined)).toBe('application/octet-stream');
      expect(sanitizeMimeType('')).toBe('application/octet-stream');
    });
  });
});
