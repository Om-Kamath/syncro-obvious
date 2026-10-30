import { describe, expect, it } from 'vitest';
import {
  collectSnapCandidates,
  DEFAULT_SNAP_THRESHOLD_PX,
  effectiveClipDuration,
  findSnap,
  type SnapCandidate,
} from './timelineSnap';

const makeClip = (id: string, startTime: number, duration: number, trimmedDuration?: number) => ({
  id,
  startTime,
  duration,
  ...(trimmedDuration !== undefined ? { trimmedDuration } : {}),
});

describe('effectiveClipDuration', () => {
  it('prefers the trimmed duration when set', () => {
    expect(effectiveClipDuration(makeClip('a', 0, 10, 4))).toBe(4);
  });

  it('falls back to the full duration when untrimmed', () => {
    expect(effectiveClipDuration(makeClip('a', 0, 10))).toBe(10);
  });
});

describe('collectSnapCandidates', () => {
  it('collects the origin, the playhead, and every other clip boundary in order', () => {
    const clips = [makeClip('a', 2, 3), makeClip('b', 10, 2)];
    const candidates = collectSnapCandidates(clips, 5.5);
    expect(candidates.map((c) => c.time)).toEqual([0, 2, 5, 5.5, 10, 12]);
    expect(candidates.map((c) => c.kind)).toEqual([
      'origin',
      'clip-start',
      'clip-end',
      'playhead',
      'clip-start',
      'clip-end',
    ]);
  });

  it('excludes the manipulated clip so an edge never snaps to itself', () => {
    const clips = [makeClip('a', 2, 3), makeClip('b', 10, 2)];
    const candidates = collectSnapCandidates(clips, 1, 'a');
    expect(candidates.map((c) => c.time)).toEqual([0, 1, 10, 12]);
  });

  it('uses the rendered duration for end boundaries, not the source duration', () => {
    const clips = [makeClip('a', 1, 10, 4)];
    const candidates = collectSnapCandidates(clips, 0);
    expect(candidates.map((c) => c.time)).toContain(5); // 1 + 4 rendered, not 1 + 10
    expect(candidates.map((c) => c.time)).not.toContain(11);
  });

  it('dedupes boundaries shared by two clips', () => {
    const clips = [makeClip('a', 0, 2), makeClip('b', 2, 3)];
    const candidates = collectSnapCandidates(clips, 0);
    expect(candidates.map((c) => c.time)).toEqual([0, 2, 5]);
    // First-added kind wins: a's end is recorded before b's start.
    expect(candidates.find((c) => c.time === 2)?.kind).toBe('clip-end');
  });
});

describe('findSnap', () => {
  const pps = 50; // default 8px threshold = 0.16s
  const candidates: SnapCandidate[] = [
    { time: 2, kind: 'clip-end' },
    { time: 5, kind: 'clip-start' },
    { time: 7.5, kind: 'playhead' },
  ];

  it('snaps the moving edge to the closest candidate within threshold', () => {
    const result = findSnap(5.1, candidates, pps);
    expect(result.time).toBe(5);
    expect(result.snappedTo).toEqual({ time: 5, kind: 'clip-start' });
  });

  it('leaves the position untouched when no candidate is within threshold', () => {
    expect(findSnap(4.0, candidates, pps)).toEqual({ time: 4.0, snappedTo: null });
  });

  it('scores candidates and picks the closest of several in range', () => {
    // 1.95 is 0.05s from clip-end(2) but 2.95s from clip-start(5).
    expect(findSnap(1.95, candidates, pps).snappedTo).toEqual({ time: 2, kind: 'clip-end' });
    // 7.42 is 0.08s from the playhead and 2.42s from clip-start(5).
    expect(findSnap(7.42, candidates, pps).snappedTo).toEqual({ time: 7.5, kind: 'playhead' });
  });

  it('scales the threshold with pixelsPerSecond: same px, different seconds', () => {
    // A 0.10s offset is 5px at 50 pps (within the 8px radius)…
    expect(findSnap(5.1, candidates, 50).snappedTo).not.toBeNull();
    // …but 10px at 100 pps (outside it).
    expect(findSnap(5.1, candidates, 100).snappedTo).toBeNull();
  });

  it('honors a custom pixel threshold', () => {
    // 4px at 50 pps = 0.08s: 0.05s away snaps, 0.10s away does not.
    expect(findSnap(5.05, candidates, 50, 4).snappedTo).not.toBeNull();
    expect(findSnap(5.1, candidates, 50, 4).snappedTo).toBeNull();
  });

  it('snaps on an exact hit', () => {
    expect(findSnap(7.5, candidates, pps).time).toBe(7.5);
  });

  it('breaks equidistant ties toward the earlier candidate', () => {
    const symmetric: SnapCandidate[] = [
      { time: 4.9, kind: 'clip-end' },
      { time: 5.1, kind: 'clip-start' },
    ];
    // Both 0.1s (5px) away — within threshold; equidistant, so the earlier wins.
    expect(findSnap(5, symmetric, pps).time).toBe(4.9);
  });

  it('passes through when there are no candidates', () => {
    expect(findSnap(3.3, [], pps)).toEqual({ time: 3.3, snappedTo: null });
  });

  it('never snaps with a non-positive scale instead of dividing to an infinite threshold', () => {
    expect(findSnap(5.1, candidates, 0)).toEqual({ time: 5.1, snappedTo: null });
  });

  it('uses the default 8px threshold when none is given', () => {
    // 8px (the default) at 50 pps = 0.16s: 0.15s away snaps, 0.17s away does not.
    expect(findSnap(5.15, candidates, 50, DEFAULT_SNAP_THRESHOLD_PX).snappedTo).not.toBeNull();
    expect(findSnap(5.17, candidates, 50).snappedTo).toBeNull();
  });
});
