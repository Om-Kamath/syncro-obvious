import { describe, it, expect } from 'vitest';
import { resolveWordTimings, findActiveWordIndex } from './wordTiming';
import type { CaptionSegment, WordTiming } from '../types';

describe('findActiveWordIndex', () => {
  it('returns the index of the word whose span contains currentTime', () => {
    const words: WordTiming[] = [
      { word: 'Hello', start: 0, end: 0.5 },
      { word: 'wide', start: 0.6, end: 1.2 },
      { word: 'world', start: 1.2, end: 1.8 },
    ];
    expect(findActiveWordIndex(words, 0.25)).toBe(0);
    expect(findActiveWordIndex(words, 0.9)).toBe(1);
    expect(findActiveWordIndex(words, 1.5)).toBe(2);
  });

  it('flips the highlight at an exact word boundary (half-open spans)', () => {
    const words: WordTiming[] = [
      { word: 'A', start: 0, end: 0.5 },
      { word: 'B', start: 0.5, end: 1.0 },
    ];
    expect(findActiveWordIndex(words, 0.499)).toBe(0);
    expect(findActiveWordIndex(words, 0.5)).toBe(1);
  });

  it('returns -1 in a silence gap between real word timings', () => {
    const words: WordTiming[] = [
      { word: 'Hello', start: 0, end: 0.5 },
      { word: 'world', start: 0.6, end: 1.2 },
    ];
    expect(findActiveWordIndex(words, 0.55)).toBe(-1);
  });

  it('returns -1 before the first word, at the last end, and after', () => {
    const words: WordTiming[] = [{ word: 'Hi', start: 1, end: 2 }];
    expect(findActiveWordIndex(words, 0.9)).toBe(-1);
    expect(findActiveWordIndex(words, 2)).toBe(-1);
    expect(findActiveWordIndex(words, 2.5)).toBe(-1);
  });

  it('returns -1 for an empty word list', () => {
    expect(findActiveWordIndex([], 0.5)).toBe(-1);
  });
});

describe('resolveWordTimings fallback', () => {
  it('returns real word timings when present', () => {
    const seg: CaptionSegment = {
      text: 'Hello world',
      start: 0,
      end: 2,
      words: [
        { word: 'Hello', start: 0, end: 1.5 },
        { word: 'world', start: 1.5, end: 2 },
      ],
    };
    expect(resolveWordTimings(seg)).toEqual(seg.words);
  });

  it('falls back to even-split timings when words are absent', () => {
    const seg: CaptionSegment = { text: 'Hello world', start: 0, end: 2 };
    expect(resolveWordTimings(seg)).toEqual([
      { word: 'Hello', start: 0, end: 1 },
      { word: 'world', start: 1, end: 2 },
    ]);
  });

  it('even-split skips extra whitespace between words', () => {
    const seg: CaptionSegment = { text: 'Hello  world', start: 0, end: 2 };
    expect(resolveWordTimings(seg)).toEqual([
      { word: 'Hello', start: 0, end: 1 },
      { word: 'world', start: 1, end: 2 },
    ]);
  });

  it('treats an empty words array as absent and falls back', () => {
    const seg: CaptionSegment = { text: 'Hi', start: 1, end: 3, words: [] };
    expect(resolveWordTimings(seg)).toEqual([{ word: 'Hi', start: 1, end: 3 }]);
  });

  it('returns no timings for an empty caption', () => {
    expect(resolveWordTimings({ text: '', start: 0, end: 2 })).toEqual([]);
  });
});

describe('word-highlight pipeline', () => {
  it('real timings: highlight tracks actual speech instead of even-split position', () => {
    // 'Hello' is spoken for nearly the whole segment; even-split would have
    // moved the highlight to 'world' halfway through.
    const seg: CaptionSegment = {
      text: 'Hello world',
      start: 0,
      end: 2,
      words: [
        { word: 'Hello', start: 0, end: 1.9 },
        { word: 'world', start: 1.9, end: 2 },
      ],
    };
    const words = resolveWordTimings(seg);
    expect(findActiveWordIndex(words, 1.0)).toBe(0);
    expect(findActiveWordIndex(words, 1.95)).toBe(1);
  });

  it('fallback: highlight index matches the legacy even-split math', () => {
    const seg: CaptionSegment = { text: 'a b c d', start: 10, end: 14 };
    const words = resolveWordTimings(seg);
    // legacy: wordIdx = floor((t - start) / wordDur), wordDur = 1
    const legacy: Array<[number, number]> = [
      [10, 0],
      [10.99, 0],
      [11, 1],
      [12.5, 2],
      [13.99, 3],
    ];
    for (const [t, expected] of legacy) {
      expect(findActiveWordIndex(words, t)).toBe(expected);
    }
    // at the exact segment end the legacy math highlighted nothing either
    expect(findActiveWordIndex(words, 14)).toBe(-1);
  });
});
