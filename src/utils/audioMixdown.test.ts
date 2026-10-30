import { describe, it, expect } from 'vitest';
import { computeMixdownDuration } from './audioMixdown';

type ClipTiming = Parameters<typeof computeMixdownDuration>[0][number];
type VoiceoverTiming = NonNullable<Parameters<typeof computeMixdownDuration>[1]>;

const clip = (over: Partial<ClipTiming> = {}): ClipTiming => ({
  startTime: 0,
  duration: 10,
  ...over,
});

const voiceover = (over: Partial<VoiceoverTiming> = {}): VoiceoverTiming => ({
  duration: 12,
  ...over,
});

describe('computeMixdownDuration', () => {
  it('returns 0 with no sources', () => {
    expect(computeMixdownDuration([], null)).toBe(0);
  });

  it('spans the last clip end when only clips exist', () => {
    expect(computeMixdownDuration([clip({ startTime: 5, duration: 3 })], null)).toBe(8);
  });

  it('prefers trimmedDuration for the clip span', () => {
    expect(computeMixdownDuration([clip({ startTime: 2, duration: 10, trimmedDuration: 4 })], null)).toBe(6);
  });

  it('shortens the span when trimStart is set without trimmedDuration', () => {
    expect(computeMixdownDuration([clip({ duration: 10, trimStart: 4 })], null)).toBe(6);
  });

  it('spans the trimmed voiceover when only a voiceover exists', () => {
    const vo = voiceover({ duration: 12, trimStart: 2, trimEnd: 9, startTime: 3 });
    expect(computeMixdownDuration([], vo)).toBe(10); // 3 + (9 − 2)
  });

  it('takes the max when clips and voiceover both exist', () => {
    const vo = voiceover({ duration: 4 });
    expect(computeMixdownDuration([clip({ startTime: 1, duration: 8 })], vo)).toBe(9);
  });

  it('never returns a negative duration', () => {
    expect(computeMixdownDuration([clip({ duration: -5 })], voiceover({ duration: -1 }))).toBe(0);
  });
});
