import { describe, it, expect } from 'vitest';
import { estimateSegments } from './gemini';

// Regex-driven regression tests for the sentence split + char-proportional
// duration distribution. These guard the fallback caption-timing math —
// the test fails if the char-proportional ratio or contiguity regresses.

describe('estimateSegments', () => {
  it('splits sentences and distributes duration proportionally by character count', () => {
    // "aa." (3 chars) and "bbbbbbbbbb." (11 chars) → 14 total chars over 28s
    const segments = estimateSegments('aa. bbbbbbbbbb.', 28);
    expect(segments).toEqual([
      { text: 'aa.', start: 0, end: 6 },
      { text: 'bbbbbbbbbb.', start: 6, end: 28 },
    ]);
  });

  it('keeps segments contiguous and ends the last segment exactly at totalDuration', () => {
    const text = 'First sentence here. Second one is longer and takes more time. Done.';
    const segments = estimateSegments(text, 30);

    expect(segments[0].start).toBe(0);
    expect(segments[segments.length - 1].end).toBe(30);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].start).toBe(segments[i - 1].end);
    }
  });

  it('gives a longer sentence a proportionally longer window', () => {
    // "ab." (3 chars) and "cdefghij." (9 chars) → 12 total chars over 24s
    const segments = estimateSegments('ab. cdefghij.', 24);
    const [shortSeg, longSeg] = segments;
    expect(longSeg.end - longSeg.start).toBeGreaterThan(shortSeg.end - shortSeg.start);
    expect(shortSeg.end - shortSeg.start).toBeCloseTo(6, 3);
    expect(longSeg.end - longSeg.start).toBeCloseTo(18, 3);
  });

  it('rounds interior boundaries to 3 decimals while preserving contiguity', () => {
    // 4/6 and 2/6 of 1s → 0.667 (rounded) then exact end at 1
    const segments = estimateSegments('aaa. b.', 1);
    expect(segments[0]).toEqual({ text: 'aaa.', start: 0, end: 0.667 });
    expect(segments[1]).toEqual({ text: 'b.', start: 0.667, end: 1 });
  });

  it('handles a single sentence spanning the whole duration', () => {
    expect(estimateSegments('only one sentence here', 12)).toEqual([
      { text: 'only one sentence here', start: 0, end: 12 },
    ]);
  });

  it('falls back to a single full-duration segment for empty input', () => {
    expect(estimateSegments('', 8)).toEqual([{ text: '', start: 0, end: 8 }]);
    expect(estimateSegments('   ', 8)).toEqual([{ text: '   ', start: 0, end: 8 }]);
  });

  it('handles text with no sentence punctuation as one segment', () => {
    expect(estimateSegments('just words here', 10)).toEqual([
      { text: 'just words here', start: 0, end: 10 },
    ]);
  });

  it('produces zero-width segments when totalDuration is 0 (degenerate input, no throw)', () => {
    const segments = estimateSegments('aa. bbb.', 0);
    expect(segments).toHaveLength(2);
    expect(segments[segments.length - 1].end).toBe(0);
  });
});
