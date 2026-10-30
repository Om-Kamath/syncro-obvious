import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_QUALITY, ExportJobError, createExportJobStore } from './exportJobQueue';

const TS0 = '2026-01-01T00:00:00.000Z';
const TS1 = '2026-01-01T00:00:01.000Z';
const TS2 = '2026-01-01T00:00:02.000Z';

/** Injected clock: yields the given timestamps in order, holding the last one. */
function clockAt(...timestamps: string[]) {
  let tick = 0;
  return () => timestamps[Math.min(tick++, timestamps.length - 1)];
}

describe('createExportJobStore.enqueue', () => {
  it('creates a queued job carrying id, project, preset, quality, and timestamps', () => {
    const store = createExportJobStore({ generateId: () => 'job-1', now: () => TS0 });
    const job = store.enqueue({ projectId: 'proj-1', preset: 'vertical' });
    expect(job).toEqual({
      id: 'job-1',
      projectId: 'proj-1',
      preset: 'vertical',
      quality: DEFAULT_EXPORT_QUALITY,
      status: 'queued',
      createdAt: TS0,
      updatedAt: TS0,
    });
    expect(job.startedAt).toBeUndefined();
    expect(job.finishedAt).toBeUndefined();
  });

  it('defaults quality to source and honors an explicit quality', () => {
    const store = createExportJobStore();
    expect(store.enqueue({ projectId: 'p1', preset: 'wide' }).quality).toBe('source');
    expect(store.enqueue({ projectId: 'p1', preset: 'wide', quality: 'low' }).quality).toBe('low');
  });

  it('hands out distinct ids across enqueues', () => {
    let seq = 0;
    const store = createExportJobStore({ generateId: () => `job-${++seq}`, now: () => TS0 });
    const first = store.enqueue({ projectId: 'p1', preset: 'wide' });
    const second = store.enqueue({ projectId: 'p1', preset: 'wide' });
    expect([first.id, second.id]).toEqual(['job-1', 'job-2']);
  });

  it('rejects a blank projectId', () => {
    const store = createExportJobStore();
    expect(() => store.enqueue({ projectId: '   ', preset: 'wide' })).toThrow(ExportJobError);
  });
});

describe('status polling shape', () => {
  it('getJobStatus returns the compact poll shape while queued', () => {
    const store = createExportJobStore({ generateId: () => 'job-1', now: () => TS0 });
    store.enqueue({ projectId: 'proj-1', preset: 'square' });
    expect(store.getJobStatus('job-1')).toEqual({
      id: 'job-1',
      status: 'queued',
      createdAt: TS0,
      updatedAt: TS0,
    });
  });

  it('omits error from the poll shape until a failure records one', () => {
    const store = createExportJobStore({
      generateId: () => 'job-1',
      now: clockAt(TS0, TS1, TS2),
    });
    store.enqueue({ projectId: 'proj-1', preset: 'square' });
    expect(store.getJobStatus('job-1')).not.toHaveProperty('error');
    store.transition('job-1', 'rendering');
    store.transition('job-1', 'failed', { error: 'encoder crashed' });
    expect(store.getJobStatus('job-1')).toEqual({
      id: 'job-1',
      status: 'failed',
      createdAt: TS0,
      updatedAt: TS2,
      error: 'encoder crashed',
    });
  });

  it('returns undefined for polls of unknown jobs', () => {
    const store = createExportJobStore();
    expect(store.get('nope')).toBeUndefined();
    expect(store.getJobStatus('nope')).toBeUndefined();
  });
});

describe('lifecycle transitions', () => {
  it('queued -> rendering stamps startedAt and advances updatedAt', () => {
    const store = createExportJobStore({
      generateId: () => 'job-1',
      now: clockAt(TS0, TS1),
    });
    store.enqueue({ projectId: 'proj-1', preset: 'wide' });
    const rendering = store.transition('job-1', 'rendering');
    expect(rendering).toMatchObject({ status: 'rendering', startedAt: TS1, updatedAt: TS1 });
    expect(rendering.finishedAt).toBeUndefined();
  });

  it('rendering -> completed stamps finishedAt', () => {
    const store = createExportJobStore({
      generateId: () => 'job-1',
      now: clockAt(TS0, TS1, TS2),
    });
    store.enqueue({ projectId: 'proj-1', preset: 'wide' });
    store.transition('job-1', 'rendering');
    const done = store.transition('job-1', 'completed');
    expect(done).toMatchObject({ status: 'completed', finishedAt: TS2 });
    expect(store.getJobStatus('job-1')).toMatchObject({ status: 'completed' });
  });

  it('queued -> cancelled stamps finishedAt without startedAt', () => {
    const store = createExportJobStore({
      generateId: () => 'job-1',
      now: clockAt(TS0, TS1),
    });
    store.enqueue({ projectId: 'proj-1', preset: 'wide' });
    const cancelled = store.transition('job-1', 'cancelled');
    expect(cancelled).toMatchObject({ status: 'cancelled', finishedAt: TS1 });
    expect(cancelled.startedAt).toBeUndefined();
  });

  it('terminal states cannot transition again', () => {
    const store = createExportJobStore({
      generateId: () => 'job-1',
      now: clockAt(TS0, TS1, TS2),
    });
    store.enqueue({ projectId: 'proj-1', preset: 'wide' });
    store.transition('job-1', 'rendering');
    store.transition('job-1', 'completed');
    expect(() => store.transition('job-1', 'rendering')).toThrow(ExportJobError);
  });

  it('transitioning an unknown id throws', () => {
    const store = createExportJobStore();
    expect(() => store.transition('ghost', 'rendering')).toThrow(ExportJobError);
  });
});

describe('listByProject', () => {
  it('returns only that project’s jobs in enqueue order', () => {
    let seq = 0;
    const store = createExportJobStore({ generateId: () => `job-${++seq}`, now: () => TS0 });
    store.enqueue({ projectId: 'proj-1', preset: 'wide' });
    store.enqueue({ projectId: 'proj-2', preset: 'square' });
    store.enqueue({ projectId: 'proj-1', preset: 'vertical' });
    expect(store.listByProject('proj-1').map((job) => job.id)).toEqual(['job-1', 'job-3']);
    expect(store.listByProject('proj-2').map((job) => job.id)).toEqual(['job-2']);
    expect(store.listByProject('proj-unknown')).toEqual([]);
  });
});
