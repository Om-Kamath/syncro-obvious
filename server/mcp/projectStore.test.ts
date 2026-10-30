import { describe, it, expect } from 'vitest';
import { InMemoryProjectStore, type StoredProject } from './projectStore';

function makeProject(overrides: Partial<StoredProject> = {}): StoredProject {
  return {
    id: 'proj-1',
    name: 'Launch teaser',
    state: { clips: [], voiceover: null, captionStyle: {}, captionsEnabled: true },
    createdAt: '2026-10-30T10:00:00.000Z',
    updatedAt: '2026-10-30T11:00:00.000Z',
    ...overrides,
  };
}

describe('InMemoryProjectStore', () => {
  it('returns an empty list for an empty store', () => {
    const store = new InMemoryProjectStore();
    expect(store.list()).toEqual([]);
    expect(store.get('proj-1')).toBeUndefined();
  });

  it('lists seeded projects most recently updated first', () => {
    const store = new InMemoryProjectStore([
      makeProject({ id: 'proj-old', name: 'Older', updatedAt: '2026-10-30T09:00:00.000Z' }),
      makeProject({ id: 'proj-new', name: 'Newer', updatedAt: '2026-10-30T11:00:00.000Z' }),
      makeProject({ id: 'proj-mid', name: 'Middle', updatedAt: '2026-10-30T10:00:00.000Z' }),
    ]);
    expect(store.list().map((p) => p.id)).toEqual(['proj-new', 'proj-mid', 'proj-old']);
  });

  it('gets a project by exact id', () => {
    const seeded = makeProject();
    const store = new InMemoryProjectStore([seeded]);
    expect(store.get('proj-1')).toBe(seeded);
    expect(store.get('proj-2')).toBeUndefined();
  });
});
