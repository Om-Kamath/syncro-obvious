import { describe, it, expect } from 'vitest';
import {
  selectionReducer,
  initialSelection,
  extendRange,
  clipIdsInRect,
  type SelectionState,
  type ClipBox,
} from './selectionReducer';

function select(ids: string[], anchorId: string | null = null): SelectionState {
  return { ids: new Set(ids), anchorId };
}

function ids(state: SelectionState): string[] {
  return [...state.ids].sort();
}

describe('selectionReducer', () => {
  it('starts with an empty selection and no anchor', () => {
    expect(ids(initialSelection)).toEqual([]);
    expect(initialSelection.anchorId).toBeNull();
  });

  describe('add', () => {
    it('adds ids to an empty selection', () => {
      const next = selectionReducer(initialSelection, { type: 'add', ids: ['a', 'b'] });
      expect(ids(next)).toEqual(['a', 'b']);
    });

    it('unions with the existing selection without duplicates', () => {
      const state = select(['a']);
      const next = selectionReducer(state, { type: 'add', ids: ['a', 'b', 'c'] });
      expect(ids(next)).toEqual(['a', 'b', 'c']);
    });

    it('keeps the existing anchor when there is one', () => {
      const state = select(['a'], 'a');
      const next = selectionReducer(state, { type: 'add', ids: ['b'] });
      expect(next.anchorId).toBe('a');
    });

    it('adopts the first added id as anchor when none exists', () => {
      const next = selectionReducer(initialSelection, { type: 'add', ids: ['b', 'c'] });
      expect(next.anchorId).toBe('b');
    });

    it('is a no-op for an empty id list and does not invent an anchor', () => {
      const state = select(['a']);
      const next = selectionReducer(state, { type: 'add', ids: [] });
      expect(next).toBe(state);
    });

    it('does not mutate the previous state', () => {
      const state = select(['a']);
      selectionReducer(state, { type: 'add', ids: ['b'] });
      expect(ids(state)).toEqual(['a']);
    });
  });

  describe('toggle', () => {
    it('adds an id that is not selected', () => {
      const next = selectionReducer(select(['a']), { type: 'toggle', id: 'b' });
      expect(ids(next)).toEqual(['a', 'b']);
    });

    it('removes an id that is selected while preserving the rest', () => {
      const next = selectionReducer(select(['a', 'b']), { type: 'toggle', id: 'a' });
      expect(ids(next)).toEqual(['b']);
    });

    it('sets the anchor to a toggled-on id', () => {
      const next = selectionReducer(select(['a'], 'a'), { type: 'toggle', id: 'b' });
      expect(next.anchorId).toBe('b');
    });

    it('keeps the anchor when toggling off a non-anchor id', () => {
      const next = selectionReducer(select(['a', 'b'], 'a'), { type: 'toggle', id: 'b' });
      expect(next.anchorId).toBe('a');
    });

    it('clears the anchor when toggling off the anchor itself', () => {
      const next = selectionReducer(select(['a', 'b'], 'a'), { type: 'toggle', id: 'a' });
      expect(next.anchorId).toBeNull();
    });

    it('does not mutate the previous state', () => {
      const state = select(['a', 'b']);
      selectionReducer(state, { type: 'toggle', id: 'a' });
      expect(ids(state)).toEqual(['a', 'b']);
    });
  });

  describe('select', () => {
    it('replaces the selection with a single id and anchors it', () => {
      const next = selectionReducer(select(['a', 'b'], 'a'), { type: 'select', id: 'c' });
      expect(ids(next)).toEqual(['c']);
      expect(next.anchorId).toBe('c');
    });
  });

  describe('set', () => {
    it('replaces the whole selection and anchors the last id', () => {
      const next = selectionReducer(select(['a']), { type: 'set', ids: ['b', 'c'] });
      expect(ids(next)).toEqual(['b', 'c']);
      expect(next.anchorId).toBe('c');
    });

    it('clears when given no ids', () => {
      const next = selectionReducer(select(['a']), { type: 'set', ids: [] });
      expect(ids(next)).toEqual([]);
      expect(next.anchorId).toBeNull();
    });
  });

  describe('extend', () => {
    const ordered = ['a', 'b', 'c', 'd'];

    it('selects the forward range from the anchor to the target', () => {
      const next = selectionReducer(select(['a'], 'a'), { type: 'extend', id: 'c', orderedIds: ordered });
      expect(ids(next)).toEqual(['a', 'b', 'c']);
    });

    it('selects the backward range when the target precedes the anchor', () => {
      const next = selectionReducer(select(['c'], 'c'), { type: 'extend', id: 'a', orderedIds: ordered });
      expect(ids(next)).toEqual(['a', 'b', 'c']);
    });

    it('keeps the original anchor so the range can grow again', () => {
      let state = selectionReducer(select(['a'], 'a'), { type: 'extend', id: 'c', orderedIds: ordered });
      state = selectionReducer(state, { type: 'extend', id: 'd', orderedIds: ordered });
      expect(ids(state)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('selects just the target when there is no anchor', () => {
      const next = selectionReducer(select(['a']), { type: 'extend', id: 'c', orderedIds: ordered });
      expect(ids(next)).toEqual(['c']);
      expect(next.anchorId).toBe('c');
    });

    it('selects just the target when the anchor is no longer in the timeline', () => {
      const next = selectionReducer(select(['z'], 'z'), { type: 'extend', id: 'b', orderedIds: ordered });
      expect(ids(next)).toEqual(['b']);
    });
  });

  describe('clear', () => {
    it('empties the selection and the anchor', () => {
      const next = selectionReducer(select(['a', 'b'], 'a'), { type: 'clear' });
      expect(ids(next)).toEqual([]);
      expect(next.anchorId).toBeNull();
    });

    it('is safe on an already-empty selection', () => {
      const next = selectionReducer(initialSelection, { type: 'clear' });
      expect(ids(next)).toEqual([]);
    });
  });
});

describe('extendRange', () => {
  const ordered = ['a', 'b', 'c', 'd'];

  it('returns the inclusive slice between anchor and target', () => {
    expect(extendRange(ordered, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(extendRange(ordered, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });

  it('returns a single-id range when anchor equals target', () => {
    expect(extendRange(ordered, 'c', 'c')).toEqual(['c']);
  });

  it('falls back to the target when the anchor is missing from the order', () => {
    expect(extendRange(ordered, 'gone', 'c')).toEqual(['c']);
  });

  it('returns nothing when the target is missing from the order', () => {
    expect(extendRange(ordered, 'a', 'gone')).toEqual([]);
  });
});

describe('clipIdsInRect', () => {
  const box = (id: string, left: number, top: number): ClipBox => ({ id, left, top, width: 100, height: 50 });
  const boxes = [box('a', 0, 0), box('b', 200, 0), box('c', 0, 100), box('d', 200, 100)];

  it('selects every clip intersecting the rect', () => {
    const hit = clipIdsInRect(boxes, { left: 50, top: 25, width: 300, height: 150 });
    expect(hit.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('selects only the clips the rect reaches', () => {
    const hit = clipIdsInRect(boxes, { left: 150, top: 0, width: 100, height: 50 });
    expect(hit).toEqual(['b']);
  });

  it('normalizes rects dragged upward and leftward (negative size)', () => {
    // Drag from bottom-right (150,120) to top-left: covers x -250..150, y 20..120
    // → hits 'a' and 'c', misses 'b' and 'd' (both start at x 200)
    const hit = clipIdsInRect(boxes, { left: 150, top: 120, width: -400, height: -100 });
    expect(hit).toEqual(['a', 'c']);
  });

  it('excludes clips only touching the rect edge exactly', () => {
    // 'b' spans x 200..300; a rect ending exactly at 200 does not overlap it
    const hit = clipIdsInRect(boxes, { left: 50, top: 0, width: 150, height: 25 });
    expect(hit).toEqual(['a']);
  });

  it('returns an empty list when nothing intersects', () => {
    expect(clipIdsInRect(boxes, { left: 1000, top: 1000, width: 50, height: 50 })).toEqual([]);
  });

  it('treats a zero-size rect as a point and hits a clip containing it', () => {
    // Point-in-box is a true geometric intersection; the Timeline skips
    // zero-move marquees before ever calling this helper.
    expect(clipIdsInRect(boxes, { left: 50, top: 25, width: 0, height: 0 })).toEqual(['a']);
    expect(clipIdsInRect(boxes, { left: 250, top: 25, width: 0, height: 0 })).toEqual(['b']);
  });
});
