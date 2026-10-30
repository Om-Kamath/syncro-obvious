import type { CaptionSegment, WordTiming } from '../types';

/**
 * Returns the word timings to render for a segment: the real per-word
 * timestamps when the transcriber supplied them, otherwise an even-split
 * synthesis of the segment text across its span (the pre-words[] fallback).
 */
export function resolveWordTimings(segment: CaptionSegment): WordTiming[] {
  if (segment.words && segment.words.length > 0) return segment.words;
  const tokens = segment.text.split(' ').filter(Boolean);
  if (tokens.length === 0) return [];
  const wordDur = (segment.end - segment.start) / tokens.length;
  return tokens.map((word, i) => ({
    word,
    start: segment.start + i * wordDur,
    end: segment.start + (i + 1) * wordDur,
  }));
}

/**
 * Index of the word being spoken at `currentTime`, or -1 when none is
 * (before the first word, in a silence gap, or at/after the last word ends).
 * Words match the half-open span [start, end) so a word boundary flips the
 * highlight exactly when the next word begins.
 */
export function findActiveWordIndex(words: WordTiming[], currentTime: number): number {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (currentTime >= w.start && currentTime < w.end) return i;
  }
  return -1;
}
