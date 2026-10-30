import { describe, expect, it } from 'vitest';
import { getClipAtTime } from './exportUtils';
import type { VideoClip } from '../types';

function makeClip(overrides: Partial<VideoClip> = {}): VideoClip {
  return {
    id: 'clip-1',
    file: new File([], 'clip.mp4'),
    url: 'blob:clip-1',
    duration: 10,
    startTime: 0,
    name: 'clip.mp4',
    ...overrides,
  };
}

describe('getClipAtTime', () => {
  it('returns null with no clips', () => {
    expect(getClipAtTime([], 0)).toBeNull();
  });

  it('maps timeline time to source-local time for untrimmed clips', () => {
    const hit = getClipAtTime([makeClip()], 2.5);
    expect(hit?.clip.id).toBe('clip-1');
    expect(hit?.localTime).toBeCloseTo(2.5);
  });

  it('offsets local time by trimStart for left-trimmed clips', () => {
    const clip = makeClip({ trimStart: 1, trimmedDuration: 3 });
    expect(getClipAtTime([clip], 0)?.localTime).toBeCloseTo(1);
    expect(getClipAtTime([clip], 2)?.localTime).toBeCloseTo(3);
  });

  it('uses the trimmed extent when handing off to the next clip', () => {
    const first = makeClip({ id: 'a', trimStart: 1, trimmedDuration: 3, startTime: 0 });
    const second = makeClip({ id: 'b', startTime: 3 });
    const hit = getClipAtTime([first, second], 3.5);
    expect(hit?.clip.id).toBe('b');
    expect(hit?.localTime).toBeCloseTo(0.5);
  });

  it('loops back with trimStart honored when time passes the timeline end', () => {
    const clip = makeClip({ trimStart: 1, trimmedDuration: 3 });
    const hit = getClipAtTime([clip], 3.5);
    expect(hit?.clip.id).toBe('clip-1');
    // Loops to 0.5s into the timeline extent → 1.5s into the source.
    expect(hit?.localTime).toBeCloseTo(1.5);
  });
});
