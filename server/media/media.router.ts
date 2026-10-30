import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { MediaStore } from './media.store';
import { parseRange } from './range';

/**
 * Upload/download for media blobs, mounted at `/api/media`.
 * POST takes the raw request body as the blob (no multipart — the client owns
 * the whole body); GET/HEAD serve the bytes back with byte-range support so
 * `<video>` elements can seek.
 */
export function createMediaRouter(store: MediaStore): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const metadata = await store.save(req, {
        filename: uploadFilename(req),
        mimeType: req.headers['content-type'],
        contentLength: parseContentLength(req.headers['content-length']),
      });
      res.status(201).location(`/api/media/${metadata.id}`).json(metadata);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', serve);
  router.head('/:id', serve);

  async function serve(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const media = await store.open(req.params.id);
      if (!media) {
        res.status(404).json({ error: `Media not found: ${req.params.id}` });
        return;
      }
      const { metadata, absolutePath } = media;
      const headers: Record<string, string> = {
        'Accept-Ranges': 'bytes',
        'Content-Disposition': `inline; filename="${metadata.filename}"`,
        'Content-Type': metadata.mimeType,
      };

      const range = parseRange(req.headers.range, metadata.size);

      if (range === 'unsatisfiable') {
        res
          .status(416)
          .set({ ...headers, 'Content-Range': `bytes */${metadata.size}` })
          .json({ error: `Requested range not satisfiable: ${String(req.headers.range)}` });
        return;
      }

      if (range === 'ignore') {
        res.status(200).set({ ...headers, 'Content-Length': String(metadata.size) });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        await streamBlob(res, absolutePath, metadata.size - 1);
        return;
      }

      res.status(206).set({
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${metadata.size}`,
        'Content-Length': String(range.end - range.start + 1),
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      await streamBlob(res, absolutePath, range.end, range.start);
    } catch (err) {
      next(err);
    }
  }

  return router;
}

/** Stream the byte range [start, end] (inclusive) of a blob into the response. */
async function streamBlob(res: Response, absolutePath: string, end: number, start = 0): Promise<void> {
  if (end < start) {
    // Zero-byte blob: headers (Content-Length: 0) already say everything.
    res.end();
    return;
  }
  try {
    await pipeline(createReadStream(absolutePath, { start, end }), res);
  } catch (err) {
    // <video> aborts range requests constantly while seeking — a premature
    // close is the client hanging up, not a server failure.
    if (isPrematureClose(err)) return;
    throw err;
  }
}

function isPrematureClose(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ERR_STREAM_PREMATURE_CLOSE';
}

/** Content-Length header → number; undefined when absent or nonsense. */
export function parseContentLength(header: string | undefined): number | undefined {
  if (!header) return undefined;
  const value = Number(header);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Upload filename: `?filename=` query param first, then the `x-filename` header. */
function uploadFilename(req: Request): string | undefined {
  const fromQuery = req.query.filename;
  if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery;
  return req.get('x-filename') ?? undefined;
}
