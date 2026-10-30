import { join } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { createMediaRouter } from './media/media.router';
import { MediaStore } from './media/media.store';

const DEFAULT_MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
const DEFAULT_MEDIA_ROOT = join(process.cwd(), 'data', 'media');

export interface MediaOptions {
  /** Directory for stored blobs. Default: `SYNCRO_MEDIA_DIR` or `<cwd>/data/media`. */
  rootDir?: string;
  /** Upload size cap in bytes. Default: `SYNCRO_MAX_UPLOAD_BYTES` or 512 MiB. */
  maxUploadBytes?: number;
}

export interface AppOptions {
  media?: MediaOptions;
}

/**
 * App factory: builds a fully-configured Express app without binding a port,
 * so tests and future tooling get a fresh instance per call.
 * server/index.ts owns the actual listener.
 */
export function createApp(options: AppOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');

  // Mounted before express.json() so binary — and mislabeled JSON — upload
  // bodies reach the media router raw instead of going through the parser.
  app.use('/api/media', createMediaRouter(createMediaStore(options.media)));

  app.use(express.json());

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  // Same payload under the /api prefix that the media routes already share.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // JSON 404 for anything unmatched — keeps API clients on JSON responses.
  app.use((req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
  });

  app.use(errorHandler);

  return app;
}

function createMediaStore(options: MediaOptions | undefined): MediaStore {
  const rootDir = options?.rootDir ?? process.env.SYNCRO_MEDIA_DIR ?? DEFAULT_MEDIA_ROOT;
  const maxUploadBytes =
    options?.maxUploadBytes ?? parseMaxUploadBytes(process.env.SYNCRO_MAX_UPLOAD_BYTES);
  return new MediaStore(rootDir, maxUploadBytes);
}

function parseMaxUploadBytes(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_MAX_UPLOAD_BYTES;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    console.warn(
      `[syncro-server] ignoring invalid SYNCRO_MAX_UPLOAD_BYTES "${raw}" — using ${DEFAULT_MAX_UPLOAD_BYTES}`,
    );
    return DEFAULT_MAX_UPLOAD_BYTES;
  }
  return value;
}

/** Map a thrown error to the HTTP status it should produce. */
export function errorStatus(err: unknown): number {
  if (hasHttpStatus(err)) return err.status;
  // express.json() surfaces malformed request bodies as SyntaxError
  if (err instanceof SyntaxError) return 400;
  return 500;
}

function hasHttpStatus(err: unknown): err is { status: number } {
  if (typeof err !== 'object' || err === null) return false;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 600;
}

/**
 * Terminal JSON error middleware. 4xx messages are safe to surface;
 * 5xx details stay in the server log only.
 */
function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const status = errorStatus(err);
  if (status >= 500) {
    console.error('[syncro-server] unhandled error:', err);
  }
  const message = status >= 500 ? 'Internal server error' : err instanceof Error ? err.message : 'Request failed';
  res.status(status).json({ error: message });
}
