import express, { type Express, type NextFunction, type Request, type Response } from 'express';

/**
 * App factory: builds a fully-configured Express app without binding a port,
 * so tests and future tooling get a fresh instance per call.
 * server/index.ts owns the actual listener.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  // Same payload under the /api prefix that CRUD routes (PRs 23+) will share.
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
