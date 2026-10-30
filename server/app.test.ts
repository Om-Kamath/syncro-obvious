import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('static file serving', () => {
  let distDir: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.SYNCRO_DIST_DIR;
    distDir = mkdtempSync(join(tmpdir(), 'syncro-dist-'));
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><html><body>syncro</body></html>');
    mkdirSync(join(distDir, 'assets'));
    writeFileSync(join(distDir, 'assets', 'app.js'), 'export const app = "syncro";\n');
    process.env.SYNCRO_DIST_DIR = distDir;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.SYNCRO_DIST_DIR;
    else process.env.SYNCRO_DIST_DIR = prevEnv;
    rmSync(distDir, { recursive: true, force: true });
  });

  it('serves index.html at /', async () => {
    const res = await request(createApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('syncro');
  });

  it('serves asset files from the dist directory', async () => {
    const res = await request(createApp()).get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('syncro');
  });

  it('still answers API routes before static files', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('keeps the JSON 404 for unknown paths not in dist', async () => {
    const res = await request(createApp()).get('/no-such-file');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('/no-such-file');
  });

  it('stays API-only when the dist directory does not exist', async () => {
    process.env.SYNCRO_DIST_DIR = join(distDir, 'does-not-exist');
    const res = await request(createApp()).get('/');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('/');
  });
});
