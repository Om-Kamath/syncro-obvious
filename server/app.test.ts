import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp, errorStatus } from './app';

describe('createApp', () => {
  it('GET /healthz responds 200 { ok: true }', async () => {
    const res = await request(createApp()).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('GET /api/health responds 200 { ok: true }', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('unknown routes respond 404 with a JSON error', async () => {
    const res = await request(createApp()).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('/does-not-exist');
  });

  it('malformed JSON bodies respond 400 without crashing the app', async () => {
    const res = await request(createApp())
      .post('/healthz')
      .set('Content-Type', 'application/json')
      .send('{"broken"');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('valid JSON bodies pass the parser and reach routing', async () => {
    const res = await request(createApp())
      .post('/healthz')
      .set('Content-Type', 'application/json')
      .send({ ok: true });
    // No POST route exists yet — 404 proves the body parser did not reject the request.
    expect(res.status).toBe(404);
  });
});

describe('GET /version', () => {
  // Read package.json independently of server/version.ts so the test cannot
  // pass by asserting a helper against itself.
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };

  it('responds 200 with { name, version } matching package.json', async () => {
    const res = await request(createApp()).get('/version');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'syncro', version: pkg.version });
  });

  it('reports a non-empty semver version string', async () => {
    const res = await request(createApp()).get('/version');
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('errorStatus', () => {
  it('defaults to 500 for unknown errors', () => {
    expect(errorStatus(new Error('boom'))).toBe(500);
    expect(errorStatus('nope')).toBe(500);
  });

  it('maps SyntaxError to 400 (malformed JSON)', () => {
    expect(errorStatus(new SyntaxError('bad json'))).toBe(400);
  });

  it('honors a numeric status on the error', () => {
    expect(errorStatus({ status: 418 })).toBe(418);
  });

  it('rejects non-error status values', () => {
    expect(errorStatus({ status: 200 })).toBe(500);
    expect(errorStatus({ status: 999 })).toBe(500);
  });
});
