import { describe, it, expect } from 'vitest';
import { chainClips } from './chainClips';
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
