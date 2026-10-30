import { describe, it, expect } from 'vitest';
import { chainClips, rippleDelete, rippleDeleteMany } from './chainClips';
import type { VideoClip } from '../types';

function makeClip(partial: Partial<VideoClip> & { id: string }): VideoClip {
  return {
    file: undefined as unknown as File,
    url: '',
    duration: 10,
    startTime: 0,
    name: partial.id,
    ...partial,
  };
}

describe('chainClips', () => {
  it('returns an empty array for an empty timeline', () => {
    expect(chainClips([])).toEqual([]);
  });

  it('chains clips back-to-back with cumulative startTime', () => {
    const clips = [
      makeClip({ id: 'a', duration: 5 }),
      makeClip({ id: 'b', duration: 3 }),
      makeClip({ id: 'c', duration: 2 }),
    ];
    const chained = chainClips(clips);
    expect(chained.map(c => c.startTime)).toEqual([0, 5, 8]);
  });

  it('uses trimmedDuration ?? duration as the effective duration', () => {
    const clips = [
      makeClip({ id: 'a', duration: 10, trimmedDuration: 4 }),
      makeClip({ id: 'b', duration: 6 }), // no trim → full duration
    ];
    const chained = chainClips(clips);
    expect(chained.map(c => c.startTime)).toEqual([0, 4]);
  });

  it('does not mutate the input clips and preserves their other fields', () => {
    const clips = [
      makeClip({ id: 'a', duration: 5, name: 'intro', track: 1, transitionIn: 'fade' }),
      makeClip({ id: 'b', duration: 7, name: 'main' }),
    ];
    const snapshot = clips.map(c => ({ ...c }));
    const chained = chainClips(clips);

    expect(chained[0].name).toBe('intro');
    expect(chained[0].track).toBe(1);
    expect(chained[0].transitionIn).toBe('fade');
    expect(chained[1].name).toBe('main');
    // Inputs untouched: startTime still 0 on the originals after chaining
    expect(clips[0]).toEqual(snapshot[0]);
    expect(clips[1]).toEqual(snapshot[1]);
  });

  it('produces a total span equal to the sum of effective durations', () => {
    const clips = [
      makeClip({ id: 'a', duration: 10, trimmedDuration: 2.5 }),
      makeClip({ id: 'b', duration: 1.5 }),
    ];
    const chained = chainClips(clips);
    const last = chained[chained.length - 1];
    expect(last.startTime + (last.trimmedDuration ?? last.duration)).toBe(4);
  });
});

describe('rippleDelete', () => {
  it('removes a middle clip and shifts subsequent clips left, closing the gap', () => {
    const clips = [
      makeClip({ id: 'a', duration: 5, startTime: 0 }),
      makeClip({ id: 'b', duration: 3, startTime: 5 }),
      makeClip({ id: 'c', duration: 2, startTime: 8 }),
    ];
    const rippled = rippleDelete(clips, 'b');
    expect(rippled.map(c => c.id)).toEqual(['a', 'c']);
    // 'c' moves from 8 to 5 — no hole where 'b' was
    expect(rippled.map(c => c.startTime)).toEqual([0, 5]);
  });

  it('rechains across a pre-existing gap in stale input startTimes', () => {
    // 'b' and 'c' carry stale positions from a prior non-ripple delete:
    // recomputation must come from effective durations, not existing startTimes.
    const clips = [
      makeClip({ id: 'a', duration: 5, startTime: 0 }),
      makeClip({ id: 'b', duration: 3, startTime: 20 }),
      makeClip({ id: 'c', duration: 4, startTime: 40 }),
    ];
    const rippled = rippleDelete(clips, 'a');
    expect(rippled.map(c => ({ id: c.id, startTime: c.startTime }))).toEqual([
      { id: 'b', startTime: 0 },
      { id: 'c', startTime: 3 },
    ]);
  });

  it('deleting the first clip shifts all remaining clips left', () => {
    const clips = [
      makeClip({ id: 'a', duration: 5, startTime: 0 }),
      makeClip({ id: 'b', duration: 3, startTime: 5 }),
      makeClip({ id: 'c', duration: 2, startTime: 8 }),
    ];
    const rippled = rippleDelete(clips, 'a');
    expect(rippled.map(c => ({ id: c.id, startTime: c.startTime }))).toEqual([
      { id: 'b', startTime: 0 },
      { id: 'c', startTime: 3 },
    ]);
  });

  it('deleting the last clip leaves earlier startTimes unchanged', () => {
    const clips = [
      makeClip({ id: 'a', duration: 5, startTime: 0 }),
      makeClip({ id: 'b', duration: 3, startTime: 5 }),
    ];
    const rippled = rippleDelete(clips, 'b');
    expect(rippled.map(c => c.startTime)).toEqual([0]);
  });

  it('chains from trimmedDuration when recomputing after a delete', () => {
    const clips = [
      makeClip({ id: 'a', duration: 10, trimmedDuration: 4, startTime: 0 }),
      makeClip({ id: 'b', duration: 6, startTime: 10 }), // stale pre-trim position
      makeClip({ id: 'c', duration: 2, startTime: 16 }),
    ];
    const rippled = rippleDelete(clips, 'a');
    expect(rippled.map(c => c.startTime)).toEqual([0, 6]);
  });

  it('returns the same array untouched when the id does not exist', () => {
    const clips = [makeClip({ id: 'a', duration: 5, startTime: 0 })];
    expect(rippleDelete(clips, 'missing')).toBe(clips);
  });

  it('does not mutate the input clips', () => {
    const clips = [
      makeClip({ id: 'a', duration: 5, startTime: 0, track: 1 }),
      makeClip({ id: 'b', duration: 3, startTime: 5 }),
    ];
    const snapshot = clips.map(c => ({ ...c }));
    rippleDelete(clips, 'a');
    expect(clips).toEqual(snapshot);
  });

  it('returns an empty array when the only clip is deleted', () => {
    expect(rippleDelete([makeClip({ id: 'a', duration: 5, startTime: 0 })], 'a')).toEqual([]);
  });
});

describe('rippleDeleteMany', () => {
  it('removes a batch of clips and closes every gap via startTime recomputation', () => {
    const clips = [
      makeClip({ id: 'a', duration: 4, startTime: 0 }),
      makeClip({ id: 'b', duration: 3, startTime: 4 }),
      makeClip({ id: 'c', duration: 5, startTime: 7 }),
      makeClip({ id: 'd', duration: 2, startTime: 12 }),
    ];
    const rippled = rippleDeleteMany(clips, ['a', 'c']);
    expect(rippled.map(c => c.id)).toEqual(['b', 'd']);
    expect(rippled.map(c => c.startTime)).toEqual([0, 3]);
  });

  it('ignores unknown ids but still removes the known ones in the same call', () => {
    const clips = [
      makeClip({ id: 'a', duration: 4, startTime: 0 }),
      makeClip({ id: 'b', duration: 3, startTime: 4 }),
    ];
    const rippled = rippleDeleteMany(clips, ['b', 'missing']);
    expect(rippled.map(c => c.id)).toEqual(['a']);
    expect(rippled.map(c => c.startTime)).toEqual([0]);
  });

  it('returns the same array untouched when no ids match', () => {
    const clips = [makeClip({ id: 'a', duration: 5, startTime: 0 })];
    expect(rippleDeleteMany(clips, ['missing'])).toBe(clips);
  });

  it('does not mutate the input clips on the batch path', () => {
    const clips = [
      makeClip({ id: 'a', duration: 5, startTime: 0, track: 1 }),
      makeClip({ id: 'b', duration: 3, startTime: 5 }),
    ];
    const snapshot = clips.map(c => ({ ...c }));
    rippleDeleteMany(clips, ['a', 'b']);
    expect(clips).toEqual(snapshot);
  });
});
