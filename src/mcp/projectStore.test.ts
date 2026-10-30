import { describe, expect, it } from 'vitest';
import { InMemoryProjectStore } from './projectStore';

describe('InMemoryProjectStore', () => {
  it('returns a stored project by id', async () => {
    const store = new InMemoryProjectStore();
    const project = { id: 'proj-1', name: 'Launch teaser', clips: [] };

    store.put(project);
    await expect(store.getProject('proj-1')).resolves.toEqual(project);
  });

  it('resolves null for an unknown id', async () => {
    const store = new InMemoryProjectStore();

    await expect(store.getProject('missing')).resolves.toBeNull();
  });

  it('replaces a record when the same id is put again', async () => {
    const store = new InMemoryProjectStore();

    store.put({ id: 'proj-1', name: 'Draft', clips: [] });
    store.put({ id: 'proj-1', name: 'Renamed', clips: [] });

    await expect(store.getProject('proj-1')).resolves.toMatchObject({ name: 'Renamed' });
  });
});
