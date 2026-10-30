import { describe, expect, it } from 'vitest';
import { computeThumbnailTimestamps, FILMSTRIP_FRAME_COUNT } from './clipThumbnails';

describe('computeThumbnailTimestamps', () => {
  it('samples the default frame count across the duration', () => {
    const ts = computeThumbnailTimestamps(12, FILMSTRIP_FRAME_COUNT);
    expect(ts).toHaveLength(FILMSTRIP_FRAME_COUNT);
    // Midpoints of six 2-second segments.
    expect(ts).toEqual([1, 3, 5, 7, 9, 11]);
  });

  it('samples the midpoint of the whole duration for a single frame', () => {
    expect(computeThumbnailTimestamps(8, 1)).toEqual([4]);
  });

  it('space five frames evenly across sixty seconds', () => {
    expect(computeThumbnailTimestamps(60, 5)).toEqual([6, 18, 30, 42, 54]);
  });

  it('handles fractional durations', () => {
    const ts = computeThumbnailTimestamps(5.5, 3);
    expect(ts).toHaveLength(3);
    for (const [i, expected] of [5.5 / 6, 5.5 / 2, (5.5 * 5) / 6].entries()) {
      expect(ts[i]).toBeCloseTo(expected, 10);
    }
  });

  it('produces strictly increasing timestamps strictly inside (0, duration)', () => {
    const ts = computeThumbnailTimestamps(3, 6);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    expect(ts[0]).toBeGreaterThan(0);
    expect(ts[ts.length - 1]).toBeLessThan(3);
  });

  it('keeps spacing uniform at any duration', () => {
    const ts = computeThumbnailTimestamps(37.25, 6);
    const spacing = ts[1] - ts[0];
    for (let i = 2; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeCloseTo(spacing, 10);
  });

  it('returns [] for zero, negative, and non-finite durations', () => {
    expect(computeThumbnailTimestamps(0, 6)).toEqual([]);
    expect(computeThumbnailTimestamps(-1, 6)).toEqual([]);
    expect(computeThumbnailTimestamps(Number.NaN, 6)).toEqual([]);
    expect(computeThumbnailTimestamps(Number.POSITIVE_INFINITY, 6)).toEqual([]);
  });

  it('returns [] for non-positive counts', () => {
    expect(computeThumbnailTimestamps(10, 0)).toEqual([]);
    expect(computeThumbnailTimestamps(10, -2)).toEqual([]);
  });

  it('floors fractional counts', () => {
    // floor(2.9) = 2 frames → midpoints of two 6-second segments.
    expect(computeThumbnailTimestamps(12, 2.9)).toEqual([3, 9]);
  });
});
