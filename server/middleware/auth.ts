import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

/** Environment variable the operator sets to the single-user API token. */
export const AUTH_TOKEN_ENV_VAR = 'SYNCRO_API_TOKEN';

/**
 * Extract the credentials from an `Authorization: Bearer <token>` header.
 * Returns null for missing headers, non-Bearer schemes, or empty tokens.
 * The scheme is case-insensitive per RFC 7235.
 */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Compare two tokens without leaking their length or a matching prefix.
 * Hashing first lets timingSafeEqual run on equal-length digests while
 * keeping the comparison constant-time in the token itself.
 */
export function tokensMatch(presented: string, expected: string): boolean {
  return timingSafeEqual(sha256(presented), sha256(expected));
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function unauthorized(res: Response, message: string): void {
  res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: message });
}

/**
 * Single-user bearer-token auth. Mount it before every API route:
 *
 *   app.use('/api', requireApiToken());
 *
 * The token lives in `SYNCRO_API_TOKEN` on the server process and is read
 * per request, so it can be rotated without a restart. Fail closed: when the
 * variable is unset or empty, every request gets a 401 rather than open access.
 */
export function requireApiToken(envVar: string = AUTH_TOKEN_ENV_VAR): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const expected = process.env[envVar];
    if (!expected) {
      unauthorized(res, 'Server is not configured with an API token');
      return;
    }
    const presented = bearerToken(req.headers.authorization);
    if (!presented || !tokensMatch(presented, expected)) {
      unauthorized(res, 'Missing or invalid bearer token');
      return;
    }
    next();
  };
}
