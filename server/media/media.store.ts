import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { HttpError } from '../httpErrors';

const BLOB_SUFFIX = '.bin';
const SIDECAR_SUFFIX = '.json';
const DEFAULT_FILENAME = 'blob';
const DEFAULT_MIME_TYPE = 'application/octet-stream';
const MAX_FILENAME_LENGTH = 200;
const MAX_MIME_LENGTH = 100;

export interface MediaMetadata {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface SavedMedia {
  metadata: MediaMetadata;
  absolutePath: string;
}

export interface UploadMeta {
  /** Client-provided filename (`?filename=` query param or `x-filename` header). */
  filename?: string;
  /** Raw `Content-Type` header of the upload. */
  mimeType?: string;
  /** Declared body size from the `Content-Length` header, when present. */
  contentLength?: number;
}

// UUIDs double as path-traversal protection: anything else is "not found".
const MEDIA_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Filesystem-backed blob store. Bytes land in `<rootDir>/<id>.bin` with
 * metadata sidecar `<id>.json`; both are written through a temp file + rename
 * so a crash mid-write never leaves a half-written record.
 */
export class MediaStore {
  constructor(
    private readonly rootDir: string,
    private readonly maxBytes: number,
  ) {
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError(`maxUploadBytes must be a positive integer, got ${maxBytes}`);
    }
  }

  /** Stream a request body to disk under the store's size cap. */
  async save(source: Readable, meta: UploadMeta = {}): Promise<MediaMetadata> {
    if (meta.contentLength !== undefined && meta.contentLength > this.maxBytes) {
      throw new HttpError(413, `Media upload exceeds the ${this.maxBytes}-byte limit`);
    }

    await mkdir(this.rootDir, { recursive: true });
    const id = randomUUID();
    const blobPath = join(this.rootDir, `${id}${BLOB_SUFFIX}`);
    const tempPath = `${blobPath}.tmp`;
    const maxBytes = this.maxBytes;
    let received = 0;

    try {
      await pipeline(
        source,
        async function* (chunks: AsyncIterable<unknown>) {
          for await (const chunk of chunks) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
            received += bytes.byteLength;
            if (received > maxBytes) {
              throw new HttpError(413, `Media upload exceeds the ${maxBytes}-byte limit`);
            }
            yield bytes;
          }
        },
        createWriteStream(tempPath),
      );
    } catch (err) {
      await rm(tempPath, { force: true });
      throw err;
    }

    const metadata: MediaMetadata = {
      id,
      filename: sanitizeFilename(meta.filename),
      mimeType: sanitizeMimeType(meta.mimeType),
      size: received,
      createdAt: new Date().toISOString(),
    };
    await rename(tempPath, blobPath);
    await writeJsonAtomic(join(this.rootDir, `${id}${SIDECAR_SUFFIX}`), metadata);
    return metadata;
  }

  /**
   * Resolve an id to its metadata + blob path; null when the media does not
   * exist. The blob's actual byte count wins over the sidecar size so the
   * advertised Content-Length always matches the bytes served.
   */
  async open(id: string): Promise<SavedMedia | null> {
    if (!MEDIA_ID_PATTERN.test(id)) return null;

    const sidecarPath = join(this.rootDir, `${id}${SIDECAR_SUFFIX}`);
    const blobPath = join(this.rootDir, `${id}${BLOB_SUFFIX}`);

    let raw: string;
    try {
      raw = await readFile(sidecarPath, 'utf8');
    } catch (err) {
      if (isMissing(err)) return null;
      throw err; // corrupt/unreadable sidecar is a server-data problem, not a 404
    }
    const metadata = JSON.parse(raw) as MediaMetadata;

    try {
      const stats = await stat(blobPath);
      return { metadata: { ...metadata, size: stats.size }, absolutePath: blobPath };
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await rename(tempPath, path);
}

/** Reduce a client filename to a safe basename for Content-Disposition. */
export function sanitizeFilename(input: string | undefined): string {
  const basename = (input ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = basename.replace(/[\p{Cc}"\\]/gu, '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return DEFAULT_FILENAME;
  return cleaned.slice(0, MAX_FILENAME_LENGTH);
}

/** Keep the bare media type (lowercased, token chars only) for Content-Type. */
export function sanitizeMimeType(input: string | undefined): string {
  const mediaType = (input ?? '').split(';')[0].trim().toLowerCase();
  if (!mediaType) return DEFAULT_MIME_TYPE;
  return (
    mediaType.replace(/[^a-z0-9!#$&^_.+-/]/g, '').slice(0, MAX_MIME_LENGTH) || DEFAULT_MIME_TYPE
  );
}
