import { describe, it, expect } from 'vitest';
import { getClipAtTime } from './exportUtils';
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

describe('getClipAtTime', () => {
  it('returns null for an empty clip list', () => {
    expect(getClipAtTime([], 0)).toBeNull();
  });

  it('finds the covering clip and maps timeline time to media time at 1×', () => {
    const clips = [
      makeClip({ id: 'a', duration: 5 }),
      makeClip({ id: 'b', duration: 5, startTime: 5 }),
    ];
    expect(getClipAtTime(clips, 0)).toEqual({ clip: clips[0], localTime: 0 });
    expect(getClipAtTime(clips, 3)).toEqual({ clip: clips[0], localTime: 3 });
    expect(getClipAtTime(clips, 7)).toEqual({ clip: clips[1], localTime: 2 });
  });

  it('compresses the coverage window at the 4× edge rate and maps into faster media time', () => {
    // A 10s clip at 4× occupies only 2.5s of timeline.
    const clip = makeClip({ id: 'fast', duration: 10, playbackRate: 4 });
    expect(getClipAtTime([clip], 1)).toEqual({ clip, localTime: 4 });
    expect(getClipAtTime([clip], 2)).toEqual({ clip, localTime: 8 });
    // Past its 2.5s occupancy the modulo fallback wraps to the start.
    expect(getClipAtTime([clip], 2.5)).toEqual({ clip, localTime: 0 });
  });

  it('stretches the coverage window at the 0.25× edge rate', () => {
    // A 10s clip at 0.25× occupies 40s of timeline; 10s in shows media at 2.5s.
    const clip = makeClip({ id: 'slow', duration: 10, playbackRate: 0.25 });
    expect(getClipAtTime([clip], 10)).toEqual({ clip, localTime: 2.5 });
    expect(getClipAtTime([clip], 39.9)).toEqual({ clip, localTime: 9.975 });
  });

  it('applies trimStart when mapping to source-media time', () => {
    const clip = makeClip({ id: 'trimmed', duration: 10, trimmedDuration: 4, trimStart: 2, playbackRate: 2 });
    // Occupancy = 4 / 2 = 2s starting at startTime 0.
    expect(getClipAtTime([clip], 1)).toEqual({ clip, localTime: 4 });
  });

  it('loops past the end using rate-aware occupancies', () => {
    const clips = [
      makeClip({ id: 'a', duration: 4, playbackRate: 4, startTime: 0 }),  // occupancy 1
      makeClip({ id: 'b', duration: 4, playbackRate: 4, startTime: 1 }),  // occupancy 1
    ];
    // Total occupancy 2 → time 2.5 loops to 0.5 into clip 'a'.
    expect(getClipAtTime(clips, 2.5)).toEqual({ clip: clips[0], localTime: 2 });
  });
});
