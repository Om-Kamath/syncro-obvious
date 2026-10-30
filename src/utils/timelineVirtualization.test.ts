import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OVERSCAN_PX,
  getVisibleTimeWindow,
  intersectsWindow,
  sliceVisibleClips,
  visibleTickRange,
} from './timelineVirtualization';

describe('getVisibleTimeWindow', () => {
  it('maps the scroll viewport px range to seconds with content offset', () => {
    // scrollLeft 504, viewport 1200, 50px/s, time 0 starts 44px in.
    const win = getVisibleTimeWindow(504, 1200, 50, 44);
    // Raw span: (504-44)/50 = 9.2s → (504+1200-44)/50 = 33.2s, padded by 96/50 = 1.92s.
    expect(win.startSec).toBeCloseTo(9.2 - 1.92, 6);
    expect(win.endSec).toBeCloseTo(33.2 + 1.92, 6);
  });

  it('never returns a negative start', () => {
    const win = getVisibleTimeWindow(0, 1200, 50, 44);
    expect(win.startSec).toBe(0);
    expect(win.endSec).toBeGreaterThan(0);
  });

  it('keeps the window scale-free by deriving overscan from px, not seconds', () => {
    // Same 96px overscan must mean more seconds when zoomed out.
    const zoomedIn = getVisibleTimeWindow(0, 1000, 200, 44);
    const zoomedOut = getVisibleTimeWindow(0, 1000, 10, 44);
    expect(zoomedOut.endSec - zoomedOut.startSec).toBeGreaterThan(zoomedIn.endSec - zoomedIn.startSec);
  });

  it('treats a zero/negative viewport as a point window instead of inverting', () => {
    const win = getVisibleTimeWindow(1000, 0, 50, 44);
    expect(win.endSec).toBeGreaterThanOrEqual(win.startSec);
  });

  it('cannot produce NaN when pixelsPerSecond is zero', () => {
    const win = getVisibleTimeWindow(100, 100, 0, 44);
    expect(Number.isFinite(win.startSec)).toBe(true);
    expect(Number.isFinite(win.endSec)).toBe(true);
  });

  it('exposes the default overscan constant', () => {
    expect(DEFAULT_OVERSCAN_PX).toBeGreaterThan(0);
  });
});

describe('intersectsWindow', () => {
  const win = { startSec: 10, endSec: 20 };

  it('matches a clip straddling the window start', () => {
    expect(intersectsWindow(8, 3, win)).toBe(true);
  });

  it('matches a clip straddling the window end', () => {
    expect(intersectsWindow(18, 4, win)).toBe(true);
  });

  it('matches a clip fully inside the window', () => {
    expect(intersectsWindow(12, 2, win)).toBe(true);
  });

  it('matches a clip fully containing the window', () => {
    expect(intersectsWindow(5, 30, win)).toBe(true);
  });

  it('rejects a clip ending exactly at the window start (half-open)', () => {
    expect(intersectsWindow(5, 5, win)).toBe(false);
  });

  it('rejects a clip starting exactly at the window end (half-open)', () => {
    expect(intersectsWindow(20, 5, win)).toBe(false);
  });

  it('rejects clips entirely before or after the window', () => {
    expect(intersectsWindow(0, 5, win)).toBe(false);
    expect(intersectsWindow(30, 5, win)).toBe(false);
  });
});

describe('sliceVisibleClips', () => {
  // Clip-like items mimicking VideoClip's layout fields (start + effective duration).
  interface Item { id: string; startTime: number; effectiveDuration: number }
  const items: Item[] = [
    { id: 'a', startTime: 0, effectiveDuration: 5 },
    { id: 'b', startTime: 5, effectiveDuration: 5 },
    { id: 'c', startTime: 10, effectiveDuration: 5 },
    { id: 'd', startTime: 15, effectiveDuration: 5 },
    { id: 'e', startTime: 100, effectiveDuration: 5 },
  ];
  const slice = (windowArg: { startSec: number; endSec: number }) =>
    sliceVisibleClips(items, windowArg, c => c.startTime, c => c.effectiveDuration);

  it('returns only clips overlapping the window, preserving order', () => {
    const visible = slice({ startSec: 6, endSec: 17 });
    expect(visible.map(c => c.id)).toEqual(['b', 'c', 'd']);
  });

  it('returns everything when the window spans the timeline', () => {
    expect(slice({ startSec: 0, endSec: 1000 })).toHaveLength(5);
  });

  it('returns nothing when the window is outside all clips', () => {
    expect(slice({ startSec: 500, endSec: 600 })).toEqual([]);
  });

  it('honors per-item accessors rather than assuming field names', () => {
    const rects = [{ at: 50, len: 0.5 }, { at: 200, len: 1 }];
    const visible = sliceVisibleClips(rects, { startSec: 0, endSec: 60 }, r => r.at, r => r.len);
    expect(visible).toEqual([{ at: 50, len: 0.5 }]);
  });

  it('does not mutate the input array', () => {
    const before = [...items];
    slice({ startSec: 6, endSec: 17 });
    expect(items).toEqual(before);
  });
});

describe('visibleTickRange', () => {
  it('floors the start and ceils the end to integer seconds', () => {
    expect(visibleTickRange({ startSec: 9.2, endSec: 33.2 })).toEqual({ from: 9, to: 34 });
  });

  it('clamps a negative start to the first tick', () => {
    expect(visibleTickRange({ startSec: -3.5, endSec: 2.5 })).toEqual({ from: 0, to: 3 });
  });

  it('returns an inclusive single-second range for a degenerate window', () => {
    expect(visibleTickRange({ startSec: 5, endSec: 5 })).toEqual({ from: 5, to: 5 });
  });
});
