import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { createApp } from '../app';
import { openDatabase } from '../db/migrate';
import { ProjectsStore } from './projects.store';
import type { ProjectState, SerializedClip } from './projectState';

function makeApp(): { app: Express; db: SqliteDatabase } {
  // createApp runs the migrations, so the returned handle has the schema ready.
  const db = openDatabase();
  return { app: createApp({ db }), db };
}

function baseClip(overrides: Partial<SerializedClip> = {}): SerializedClip {
  return {
    id: 'clip-1',
    name: 'intro.mp4',
    duration: 12.5,
    startTime: 0,
    trimmedDuration: 10,
    trimStart: 0.5,
    textOverlay: 'Hello',
    track: 0,
    transitionIn: 'fade',
    analysis: 'opens on a skyline',
    alternatives: [{ id: 'alt-1', confidence: 0.8, reason: 'better pacing' }],
    ...overrides,
  };
}

function validState(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    clips: [baseClip()],
    voiceover: {
      duration: 10,
      trimStart: 0,
      trimEnd: 9.5,
      transcription: 'hello world',
      segments: [{ text: 'hello world', start: 0, end: 9.5 }],
      startTime: 0.25,
    },
    captionStyle: { mode: 'word-highlight', fontSize: 32, color: '#ffffff', bgColor: '#000000', position: 'bottom' },
    captionsEnabled: true,
    ...overrides,
  };
}

function projectPayload(name: string, state: ProjectState): { name: string; state: ProjectState } {
  return { name, state };
}

describe('POST /api/projects', () => {
  it('creates a project and echoes the normalized state with metadata', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/projects').send(projectPayload('Launch video', validState()));

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/projects/${res.body.id}`);
    expect(typeof res.body.id).toBe('string');
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.name).toBe('Launch video');
    expect(res.body.state).toEqual(validState());
    expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt);
    expect(res.body.updatedAt).toBe(res.body.createdAt);
  });

  it('treats an omitted voiceover as null', async () => {
    const { app } = makeApp();
    const state = validState({ voiceover: undefined });
    const res = await request(app).post('/api/projects').send(projectPayload('No voice', state));

    expect(res.status).toBe(201);
    expect(res.body.state.voiceover).toBeNull();
  });

  it('strips browser-only handles (file/url) and unknown keys from clips', async () => {
    const { app } = makeApp();
    const clip = baseClip({
      ...({ file: '/tmp/upload.mp4', url: 'blob:http://localhost:3000/abc', rogue: true } as Partial<SerializedClip>),
    });
    const res = await request(app).post('/api/projects').send(projectPayload('Clean', validState({ clips: [clip] })));

    expect(res.status).toBe(201);
    expect(res.body.state.clips).toEqual([baseClip()]);
  });
});

describe('CRUD round-trip', () => {
  it('create → list → get → update → delete', async () => {
    const { app } = makeApp();

    const created = await request(app).post('/api/projects').send(projectPayload('Round trip', validState()));
    const id = created.body.id as string;

    const list = await request(app).get('/api/projects');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(id);

    const fetched = await request(app).get(`/api/projects/${id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(created.body);

    const updatedState = validState({ clips: [baseClip(), baseClip({ id: 'clip-2', name: 'outro.mp4', startTime: 10 })] });
    const updated = await request(app).put(`/api/projects/${id}`).send(projectPayload('Round trip v2', updatedState));
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Round trip v2');
    expect(updated.body.state).toEqual(updatedState);
    expect(updated.body.updatedAt >= updated.body.createdAt).toBe(true);

    const refetched = await request(app).get(`/api/projects/${id}`);
    expect(refetched.body.name).toBe('Round trip v2');
    expect(refetched.body.state.clips).toHaveLength(2);

    const removed = await request(app).delete(`/api/projects/${id}`);
    expect(removed.status).toBe(204);

    expect((await request(app).get(`/api/projects/${id}`)).status).toBe(404);
    expect((await request(app).get('/api/projects')).body).toEqual([]);
    expect((await request(app).delete(`/api/projects/${id}`)).status).toBe(404);
  });

  it('unknown ids respond 404 with a JSON error', async () => {
    const { app } = makeApp();
    // PUT carries a valid payload so the 404 comes from the missing row, not the validator.
    const missingPut = await request(app)
      .put('/api/projects/no-such-id')
      .send(projectPayload('Ghost', validState()));
    expect(missingPut.status).toBe(404);
    expect(missingPut.body.error).toContain('no-such-id');

    const missingGet = await request(app).get('/api/projects/no-such-id');
    expect(missingGet.status).toBe(404);
    expect(missingGet.body.error).toContain('no-such-id');

    const missingDelete = await request(app).delete('/api/projects/no-such-id');
    expect(missingDelete.status).toBe(404);
    expect(missingDelete.body.error).toContain('no-such-id');
  });
});

describe('validation failures respond 400', () => {
  const cases: Array<{ label: string; body: unknown; message: string }> = [
    { label: 'missing name', body: { state: validState() }, message: 'name' },
    { label: 'blank name', body: { name: '   ', state: validState() }, message: 'name' },
    { label: 'non-string name', body: { name: 42, state: validState() }, message: 'name' },
    { label: 'missing state', body: { name: 'X' }, message: 'state' },
    { label: 'non-object state', body: { name: 'X', state: 'nope' }, message: 'state must be an object' },
    { label: 'clips not an array', body: { name: 'X', state: { ...validState(), clips: 'nope' } }, message: 'clips must be an array' },
    {
      label: 'clip missing id',
      body: { name: 'X', state: validState({ clips: [baseClip({ id: undefined })] }) },
      message: 'clips[0].id',
    },
    {
      label: 'negative clip duration',
      body: { name: 'X', state: validState({ clips: [baseClip({ duration: -1 })] }) },
      message: 'clips[0].duration',
    },
    {
      label: 'unknown transition',
      body: { name: 'X', state: validState({ clips: [baseClip({ transitionIn: 'zoom' as never })] }) },
      message: 'clips[0].transitionIn',
    },
    {
      label: 'fractional track',
      body: { name: 'X', state: validState({ clips: [baseClip({ track: 1.5 })] }) },
      message: 'clips[0].track',
    },
    {
      label: 'alternative confidence out of range',
      body: { name: 'X', state: validState({ clips: [baseClip({ alternatives: [{ id: 'a', confidence: 1.5, reason: 'r' }] })] }) },
      message: 'alternatives[0].confidence',
    },
    {
      label: 'segment start after end',
      body: {
        name: 'X',
        state: validState({ voiceover: { duration: 10, segments: [{ text: 'a', start: 5, end: 4 }] } }),
      },
      message: 'voiceover.segments[0].start',
    },
    {
      label: 'unknown caption mode',
      body: { name: 'X', state: validState({ captionStyle: { mode: 'karaoke' as never, fontSize: 32, color: '#fff', bgColor: '#000', position: 'bottom' } }) },
      message: 'captionStyle.mode',
    },
    {
      label: 'non-positive fontSize',
      body: { name: 'X', state: validState({ captionStyle: { mode: 'lower-third', fontSize: 0, color: '#fff', bgColor: '#000', position: 'bottom' } }) },
      message: 'captionStyle.fontSize',
    },
    {
      label: 'captionsEnabled not a boolean',
      body: { name: 'X', state: { ...validState(), captionsEnabled: 'yes' } },
      message: 'captionsEnabled',
    },
  ];

  it.each(cases)('rejects $label', async ({ body, message }) => {
    const { app } = makeApp();
    const res = await request(app).post('/api/projects').send(body as object);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error).toContain(message);
  });

  it('rejects a non-object body', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/projects').send(['not', 'an', 'object']);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('JSON object');
  });

  it('rejects a missing body', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/projects').send();
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('rejects malformed JSON without crashing the app', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/projects')
      .set('Content-Type', 'application/json')
      .send('{"broken"');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');

    // The app still serves requests after the failed parse.
    expect((await request(app).get('/api/projects')).status).toBe(200);
  });

  it('rejects an invalid PUT body with 400 before touching the row', async () => {
    const { app } = makeApp();
    const created = await request(app).post('/api/projects').send(projectPayload('Before', validState()));
    const id = created.body.id as string;

    const res = await request(app).put(`/api/projects/${id}`).send({ name: 'After' });
    expect(res.status).toBe(400);

    const refetched = await request(app).get(`/api/projects/${id}`);
    expect(refetched.body.name).toBe('Before');
  });
});

describe('ProjectsStore ordering', () => {
  it('lists most recently updated first', () => {
    const { db } = makeApp();
    const store = new ProjectsStore(db);
    store.create('A', validState());
    const b = store.create('B', validState());

    // Pin B to a distinct old timestamp so the assertion cannot depend on
    // clock resolution (two writes can land in the same millisecond).
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', b.id);

    expect(store.list().map((p) => p.name)).toEqual(['A', 'B']);
  });
});
