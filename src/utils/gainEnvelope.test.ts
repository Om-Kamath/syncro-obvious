import { describe, expect, it } from 'vitest';
import { activeClipAtTime, computeGainEnvelope, FADE_SECONDS_INPUT_RE, parseFadeSeconds, programGainAtTime } from './gainEnvelope';
import { VideoClip } from '../types';

function clip(overrides: Partial<VideoClip> = {}): VideoClip {
  return {
    id: 'c1',
    file: new File([], 'a.mp4'),
    url: 'blob:a',
    duration: 10,
    startTime: 0,
    name: 'a.mp4',
    ...overrides,
  };
}

describe('computeGainEnvelope', () => {
  it('is neutral (1) everywhere when no fades are configured', () => {
    for (const t of [0, 0.5, 5, 9.999, 10]) {
      expect(computeGainEnvelope({ localTime: t, clipDuration: 10 })).toBe(1);
      expect(computeGainEnvelope({ localTime: t, clipDuration: 10, fadeIn: 0, fadeOut: 0 })).toBe(1);
    }
  });

  it('ramps linearly from 0 to 1 across the fade-in window', () => {
    const p = { localTime: 0, clipDuration: 10, fadeIn: 2 };
    expect(computeGainEnvelope({ ...p, localTime: 0 })).toBe(0);
    expect(computeGainEnvelope({ ...p, localTime: 0.5 })).toBeCloseTo(0.25, 10);
    expect(computeGainEnvelope({ ...p, localTime: 1 })).toBeCloseTo(0.5, 10);
    expect(computeGainEnvelope({ ...p, localTime: 2 })).toBe(1);
    expect(computeGainEnvelope({ ...p, localTime: 5 })).toBe(1);
  });

  it('ramps linearly from 1 to 0 across the fade-out window', () => {
    const p = { localTime: 0, clipDuration: 10, fadeOut: 2 };
    expect(computeGainEnvelope({ ...p, localTime: 8 })).toBe(1);
    expect(computeGainEnvelope({ ...p, localTime: 9 })).toBeCloseTo(0.5, 10);
    expect(computeGainEnvelope({ ...p, localTime: 10 })).toBe(0);
  });

  it('combines both ramps and holds full gain between them', () => {
    const p = { clipDuration: 10, fadeIn: 2, fadeOut: 3 };
    expect(computeGainEnvelope({ ...p, localTime: 0 })).toBe(0);
    expect(computeGainEnvelope({ ...p, localTime: 1 })).toBeCloseTo(0.5, 10);
    expect(computeGainEnvelope({ ...p, localTime: 2 })).toBe(1);
    expect(computeGainEnvelope({ ...p, localTime: 7 })).toBe(1);
    expect(computeGainEnvelope({ ...p, localTime: 9 })).toBeCloseTo(1 / 3, 10);
    expect(computeGainEnvelope({ ...p, localTime: 10 })).toBe(0);
  });

  it('forms a triangle when the fades overlap and never reaches full gain', () => {
    const p = { clipDuration: 4, fadeIn: 3, fadeOut: 3 };
    expect(computeGainEnvelope({ ...p, localTime: 0 })).toBe(0);
    expect(computeGainEnvelope({ ...p, localTime: 1 })).toBeCloseTo(1 / 3, 10);
    expect(computeGainEnvelope({ ...p, localTime: 2 })).toBeCloseTo(2 / 3, 10);
    expect(computeGainEnvelope({ ...p, localTime: 3 })).toBeCloseTo(1 / 3, 10);
    expect(computeGainEnvelope({ ...p, localTime: 4 })).toBe(0);
  });

  it('peaks at exactly 1 when complementary fades meet at the midpoint', () => {
    const p = { clipDuration: 2, fadeIn: 1, fadeOut: 1 };
    expect(computeGainEnvelope({ ...p, localTime: 1 })).toBe(1);
  });

  it('returns 0 outside the clip span', () => {
    const p = { clipDuration: 10, fadeIn: 2, fadeOut: 2 };
    expect(computeGainEnvelope({ ...p, localTime: -0.001 })).toBe(0);
    expect(computeGainEnvelope({ ...p, localTime: 10.001 })).toBe(0);
  });

  it('treats degenerate fade values as no fade', () => {
    for (const bad of [undefined, 0, -1, Number.NaN]) {
      expect(computeGainEnvelope({ localTime: 0, clipDuration: 10, fadeIn: bad })).toBe(1);
      expect(computeGainEnvelope({ localTime: 10, clipDuration: 10, fadeOut: bad })).toBe(1);
    }
  });

  it('returns 0 for degenerate clip spans or times', () => {
    expect(computeGainEnvelope({ localTime: 0, clipDuration: 0, fadeIn: 1 })).toBe(0);
    expect(computeGainEnvelope({ localTime: 0, clipDuration: -5 })).toBe(0);
    expect(computeGainEnvelope({ localTime: Number.NaN, clipDuration: 10 })).toBe(0);
  });
});

describe('parseFadeSeconds', () => {
  it('parses valid positive decimal seconds', () => {
    expect(parseFadeSeconds('0.5')).toBe(0.5);
    expect(parseFadeSeconds('2')).toBe(2);
    expect(parseFadeSeconds(' 1.25 ')).toBe(1.25);
  });

  it('maps empty and non-positive inputs to no fade (undefined)', () => {
    expect(parseFadeSeconds('')).toBeUndefined();
    expect(parseFadeSeconds('   ')).toBeUndefined();
    expect(parseFadeSeconds('0')).toBeUndefined();
    expect(parseFadeSeconds('-1')).toBeUndefined();
    expect(parseFadeSeconds('abc')).toBeUndefined();
    expect(parseFadeSeconds('.')).toBeUndefined();
  });

  it('sanitizer accepts only typing states made of digits and one dot', () => {
    for (const ok of ['', '0', '0.', '0.5', '12', '.5', '1.2.']) {
      expect(FADE_SECONDS_INPUT_RE.test(ok)).toBe(ok !== '1.2.');
    }
    for (const bad of ['a', '-1', '1..2', '1,5', '1e3']) {
      expect(FADE_SECONDS_INPUT_RE.test(bad)).toBe(false);
    }
  });
});

describe('activeClipAtTime', () => {
  it('finds the covering clip and its span-relative time', () => {
    const clips = [clip({ id: 'a', startTime: 5 })];
    expect(activeClipAtTime(clips, 7)).toEqual({ clip: clips[0], localTime: 2 });
  });

  it('honors trimmedDuration as the clip span', () => {
    const a = clip({ id: 'a', startTime: 0, trimmedDuration: 2 });
    const b = clip({ id: 'b', startTime: 2, duration: 10 });
    const clips = [a, b];
    expect(activeClipAtTime(clips, 2.5)?.clip.id).toBe('b');
    expect(activeClipAtTime(clips, 1.999)?.clip.id).toBe('a');
  });

  it('prefers the later clip when spans overlap', () => {
    const a = clip({ id: 'a', startTime: 0, duration: 10 });
    const b = clip({ id: 'b', startTime: 4, duration: 10 });
    expect(activeClipAtTime([a, b], 5)?.clip.id).toBe('b');
  });

  it('returns null for no clips and for timeline gaps', () => {
    expect(activeClipAtTime([], 3)).toBeNull();
    expect(activeClipAtTime([clip({ startTime: 5 })], 3)).toBeNull();
  });
});

describe('programGainAtTime', () => {
  it('is neutral when no clip covers the time', () => {
    expect(programGainAtTime([], 5)).toBe(1);
    expect(programGainAtTime([clip({ startTime: 10 })], 5)).toBe(1);
  });

  it('applies the covering clip envelope to the program audio', () => {
    const clips = [clip({ id: 'a', startTime: 0, duration: 10, fadeIn: 2, fadeOut: 2 })];
    expect(programGainAtTime(clips, 0)).toBe(0);
    expect(programGainAtTime(clips, 1)).toBeCloseTo(0.5, 10);
    expect(programGainAtTime(clips, 5)).toBe(1);
    expect(programGainAtTime(clips, 9.5)).toBeCloseTo(0.25, 10);
  });

  it('is neutral at the exact end boundary where no clip covers anymore', () => {
    const clips = [clip({ id: 'a', startTime: 0, duration: 10, fadeOut: 2 })];
    expect(programGainAtTime(clips, 10)).toBe(1); // exclusive end: uncovered → neutral, like a timeline gap
  });

  it('uses the trimmed span for untrimmed-equivalent math', () => {
    const clips = [
      clip({ id: 'a', startTime: 0, duration: 10, trimmedDuration: 4, fadeOut: 2 }),
    ];
    expect(programGainAtTime(clips, 3)).toBeCloseTo(0.5, 10);
    expect(programGainAtTime(clips, 3.5)).toBeCloseTo(0.25, 10);
    expect(programGainAtTime(clips, 4)).toBe(1); // past the trimmed span → uncovered → neutral
  });

  it('switches envelopes at clip boundaries', () => {
    const a = clip({ id: 'a', startTime: 0, duration: 4, fadeOut: 2 });
    const b = clip({ id: 'b', startTime: 4, duration: 4, fadeIn: 2 });
    const clips = [a, b];
    expect(programGainAtTime(clips, 4)).toBe(0); // b's fade-in start
    expect(programGainAtTime(clips, 3)).toBeCloseTo(0.5, 10); // a's fade-out
  });
});
