import { describe, it, expect } from 'vitest';
import {
  cancelAllItems,
  cancelCurrent,
  clearFinishedItems,
  completeCurrent,
  enqueueItem,
  failCurrent,
  getRenderingItem,
  isPresetPending,
  removeQueueItem,
  setItemProgress,
  startNext,
  type ExportQueueItem,
} from './exportQueue';

function queueOf(...presetIds: ExportQueueItem['presetId'][]): ExportQueueItem[] {
  let items: ExportQueueItem[] = [];
  for (const presetId of presetIds) {
    items = enqueueItem(items, presetId).items;
  }
  return items;
}

describe('enqueueItem', () => {
  it('appends a queued item with an incremental id', () => {
    const first = enqueueItem([], 'wide');
    expect(first.item).toMatchObject({ id: 1, presetId: 'wide', status: 'queued', progress: 0 });

    const second = enqueueItem(first.items, 'vertical');
    expect(second.item.id).toBe(2);
    expect(second.items).toHaveLength(2);
  });

  it('does not mutate the input array', () => {
    const items = queueOf('wide');
    const { items: next } = enqueueItem(items, 'square');
    expect(items).toHaveLength(1);
    expect(next).toHaveLength(2);
  });
});

describe('startNext', () => {
  it('promotes the first queued item to rendering', () => {
    const transition = startNext(queueOf('wide', 'vertical'));
    expect(transition.started).toMatchObject({ id: 1, presetId: 'wide', status: 'rendering' });
    expect(transition.items[0].status).toBe('rendering');
    expect(transition.items[1].status).toBe('queued');
  });

  it('is a no-op while another render is active', () => {
    const { items } = startNext(queueOf('wide', 'vertical'));
    const transition = startNext(items);
    expect(transition.started).toBeNull();
    expect(transition.items).toEqual(items);
  });

  it('is a no-op when nothing is queued', () => {
    expect(startNext([]).started).toBeNull();
    const terminal = completeCurrent(startNext(queueOf('wide')).items, 1);
    expect(startNext(terminal.items).started).toBeNull();
  });
});

describe('completeCurrent (advance)', () => {
  it('marks the rendering item done and promotes the next queued item', () => {
    const { items } = startNext(queueOf('wide', 'vertical', 'square'));
    const transition = completeCurrent(items, 1);
    expect(transition.items[0]).toMatchObject({ status: 'done', progress: 1 });
    expect(transition.started).toMatchObject({ id: 2, presetId: 'vertical', status: 'rendering' });
  });

  it('returns started null when the last item finishes', () => {
    const { items } = startNext(queueOf('wide'));
    const transition = completeCurrent(items, 1);
    expect(transition.items[0].status).toBe('done');
    expect(transition.started).toBeNull();
  });

  it('is a no-op when the id is not the rendering item', () => {
    const { items } = startNext(queueOf('wide', 'vertical'));
    const transition = completeCurrent(items, 2);
    expect(transition.started).toBeNull();
    expect(transition.items).toEqual(items);
  });
});

describe('cancelCurrent', () => {
  it('marks the rendering item cancelled and promotes the next queued item', () => {
    const { items } = startNext(queueOf('wide', 'vertical', 'square'));
    const transition = cancelCurrent(items, 1);
    expect(transition.items[0].status).toBe('cancelled');
    expect(transition.started).toMatchObject({ id: 2, status: 'rendering' });
    expect(transition.items).toHaveLength(3);
  });

  it('keeps done items untouched while cancelling the current render', () => {
    const { items } = startNext(queueOf('wide', 'vertical'));
    const advanced = completeCurrent(items, 1);
    const transition = cancelCurrent(advanced.items, 2);
    expect(transition.items[0].status).toBe('done');
    expect(transition.items[1].status).toBe('cancelled');
    expect(transition.started).toBeNull();
  });

  it('is a no-op when the id is not the rendering item', () => {
    const { items } = startNext(queueOf('wide'));
    const transition = cancelCurrent(items, 99);
    expect(transition.items).toEqual(items);
    expect(transition.started).toBeNull();
  });
});

describe('failCurrent', () => {
  it('records the error and promotes the next queued item', () => {
    const { items } = startNext(queueOf('wide', 'square'));
    const transition = failCurrent(items, 1, 'Audio load failed');
    expect(transition.items[0]).toMatchObject({ status: 'failed', error: 'Audio load failed' });
    expect(transition.started).toMatchObject({ id: 2, status: 'rendering' });
  });
});

describe('setItemProgress', () => {
  it('clamps progress to 0..1 on the rendering item', () => {
    const { items } = startNext(queueOf('wide'));
    expect(setItemProgress(items, 1, 1.5)[0].progress).toBe(1);
    expect(setItemProgress(items, 1, -1)[0].progress).toBe(0);
    expect(setItemProgress(items, 1, 0.42)[0].progress).toBeCloseTo(0.42);
  });

  it('ignores items that are not rendering', () => {
    const items = queueOf('wide', 'vertical');
    expect(setItemProgress(items, 1, 0.5)[0].progress).toBe(0);
  });
});

describe('cancelAllItems', () => {
  it('cancels the active render and all queued items, keeping done items', () => {
    const { items } = startNext(queueOf('wide', 'vertical', 'square'));
    const advanced = completeCurrent(items, 1);
    const next = cancelAllItems(advanced.items);
    expect(next.map(item => item.status)).toEqual(['done', 'cancelled', 'cancelled']);
    expect(getRenderingItem(next)).toBeNull();
  });
});

describe('removeQueueItem', () => {
  it('removes only queued items', () => {
    const { items } = startNext(queueOf('wide', 'vertical', 'square'));
    const removed = removeQueueItem(items, 3);
    expect(removed.map(item => item.id)).toEqual([1, 2]);
    expect(removeQueueItem(items, 1)).toEqual(items); // rendering item stays
  });
});

describe('clearFinishedItems', () => {
  it('drops terminal items and keeps queued/rendering ones', () => {
    const { items } = startNext(queueOf('wide', 'vertical', 'square'));
    const advanced = completeCurrent(items, 1);
    const kept = clearFinishedItems(advanced.items);
    expect(kept.map(item => item.status)).toEqual(['rendering', 'queued']);
  });
});

describe('isPresetPending', () => {
  it('is true for queued and rendering presets, false for finished ones', () => {
    const { items } = startNext(queueOf('wide', 'vertical'));
    expect(isPresetPending(items, 'wide')).toBe(true);
    expect(isPresetPending(items, 'vertical')).toBe(true);
    expect(isPresetPending(items, 'square')).toBe(false);

    const advanced = completeCurrent(items, 1);
    expect(isPresetPending(advanced.items, 'wide')).toBe(false);
  });
});

describe('sequential scenario', () => {
  it('runs a three-preset batch: enqueue, advance, cancel current, finish', () => {
    // Enqueue 16:9 + 9:16 + 1:1 and start the first render.
    let items = queueOf('wide', 'vertical', 'square');
    const first = startNext(items);
    items = first.items;
    expect(getRenderingItem(items)?.presetId).toBe('wide');

    // Progress ticks on the active render.
    items = setItemProgress(items, 1, 0.5);

    // Advance: 16:9 done, 9:16 starts.
    const advanced = completeCurrent(items, 1);
    items = advanced.items;
    expect(getRenderingItem(items)?.presetId).toBe('vertical');

    // Cancel current: 9:16 cancelled, 1:1 starts.
    const cancelled = cancelCurrent(items, 2);
    items = cancelled.items;
    expect(getRenderingItem(items)?.presetId).toBe('square');

    // Finish the batch.
    const last = completeCurrent(items, 3);
    items = last.items;
    expect(last.started).toBeNull();
    expect(items.map(item => item.status)).toEqual(['done', 'cancelled', 'done']);
    expect(getRenderingItem(items)).toBeNull();
  });
});
