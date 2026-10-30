import express, { type Express } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { AUTH_TOKEN_ENV_VAR, bearerToken, requireApiToken } from './auth';

const TOKEN = 'test-token-abc123';

/** Minimal app with the middleware mounted over a representative set of API routes. */
function authedApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', requireApiToken());
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/projects', (_req, res) => res.json({ projects: [] }));
  app.post('/api/projects', (_req, res) => res.status(201).json({ id: 'p1' }));
  return app;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requireApiToken over all /api routes', () => {
  it('allows every route with the correct bearer token', async () => {
    vi.stubEnv(AUTH_TOKEN_ENV_VAR, TOKEN);
    const app = authedApp();
    const auth = { Authorization: `Bearer ${TOKEN}` };

    expect((await request(app).get('/api/health').set(auth)).status).toBe(200);
    expect((await request(app).get('/api/projects').set(auth)).status).toBe(200);
    expect((await request(app).post('/api/projects').set(auth)).status).toBe(201);
  });

  it('returns 401 when the Authorization header is missing', async () => {
    vi.stubEnv(AUTH_TOKEN_ENV_VAR, TOKEN);
    const res = await request(authedApp()).get('/api/health');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Missing or invalid bearer token');
  });

  it('returns 401 when the token is wrong', async () => {
    vi.stubEnv(AUTH_TOKEN_ENV_VAR, TOKEN);
    const res = await request(authedApp()).get('/api/health').set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a non-Bearer scheme', async () => {
    vi.stubEnv(AUTH_TOKEN_ENV_VAR, TOKEN);
    const res = await request(authedApp()).get('/api/health').set('Authorization', `Basic ${TOKEN}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 with an empty bearer token', async () => {
    vi.stubEnv(AUTH_TOKEN_ENV_VAR, TOKEN);
    const res = await request(authedApp()).get('/api/health').set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
  });

  it('fails closed with 401 when the token env var is unset', async () => {
    vi.stubEnv(AUTH_TOKEN_ENV_VAR, '');
    const res = await request(authedApp()).get('/api/health').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Server is not configured with an API token');
  });

  it('sets WWW-Authenticate on every 401', async () => {
    vi.stubEnv(AUTH_TOKEN_ENV_VAR, TOKEN);
    const res = await request(authedApp()).get('/api/health');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('accepts a case-insensitive Bearer scheme', async () => {
    vi.stubEnv(AUTH_TOKEN_ENV_VAR, TOKEN);
    const res = await request(authedApp()).get('/api/health').set('Authorization', `bearer ${TOKEN}`);
    expect(res.status).toBe(200);
  });
});

describe('bearerToken parser', () => {
  it('parses a well-formed header', () => {
    expect(bearerToken('Bearer tok')).toBe('tok');
    expect(bearerToken('  bearer   tok ')).toBe('tok');
  });

  it('returns null for missing, malformed, or empty credentials', () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('')).toBeNull();
    expect(bearerToken('Bearer')).toBeNull();
    expect(bearerToken('Bearer  ')).toBeNull();
    expect(bearerToken('Token abc')).toBeNull();
  });
});
