import { describe, it, expect } from 'vitest';
import {
  activeWordIndex,
  canvasWordFont,
  resolveWordStyle,
  splitWords,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_HIGHLIGHT_SCALE,
  DEFAULT_HIGHLIGHT_WEIGHT,
} from './captionEmphasis';
import type { CaptionStyle } from '../types';

const baseStyle: CaptionStyle = {
  mode: 'word-highlight',
  fontSize: 28,
  color: '#ffffff',
  bgColor: 'rgba(0,0,0,0.6)',
  position: 'bottom',
};

describe('splitWords', () => {
  it('splits on spaces and drops empty tokens', () => {
    expect(splitWords('one  two ')).toEqual(['one', 'two']);
    expect(splitWords('   ')).toEqual([]);
  });
});

describe('activeWordIndex', () => {
  // 4 words over [10, 14] → 1s per word.
  const text = 'one two three four';
  const start = 10;
  const end = 14;

  it('resolves the first word at segment start', () => {
    expect(activeWordIndex(text, start, end, 10)).toBe(0);
    expect(activeWordIndex(text, start, end, 10.99)).toBe(0);
  });

  it('advances one word per even slice', () => {
    expect(activeWordIndex(text, start, end, 11)).toBe(1);
    expect(activeWordIndex(text, start, end, 13.5)).toBe(3);
  });

  it('returns -1 outside the segment or past the last word', () => {
    expect(activeWordIndex(text, start, end, 9.99)).toBe(-1);
    expect(activeWordIndex(text, start, end, 14)).toBe(-1);
    expect(activeWordIndex(text, start, end, 15)).toBe(-1);
  });

  it('returns -1 for empty text and degenerate segments', () => {
    expect(activeWordIndex('', start, end, 10)).toBe(-1);
    expect(activeWordIndex(text, 5, 5, 5)).toBe(-1);
    expect(activeWordIndex(text, 6, 5, 5)).toBe(-1);
  });
});

describe('resolveWordStyle', () => {
  it('gives non-highlighted words the base color at rest weight and scale', () => {
    const style = { ...baseStyle, wordEmphasis: { color: '#facc15', fontWeight: 900, scale: 1.4 } };
    expect(resolveWordStyle(style, false)).toEqual({ color: '#ffffff', fontWeight: 500, scale: 1 });
  });

  it('falls back to the built-in highlight look when wordEmphasis is undefined', () => {
    expect(resolveWordStyle(baseStyle, true)).toEqual({
      color: DEFAULT_HIGHLIGHT_COLOR,
      fontWeight: DEFAULT_HIGHLIGHT_WEIGHT,
      scale: DEFAULT_HIGHLIGHT_SCALE,
    });
  });

  it('applies full emphasis overrides to the highlighted word', () => {
    const style = { ...baseStyle, wordEmphasis: { color: '#facc15', fontWeight: 800, scale: 1.25 } };
    expect(resolveWordStyle(style, true)).toEqual({ color: '#facc15', fontWeight: 800, scale: 1.25 });
  });

  it('fills missing emphasis fields from the defaults', () => {
    const colorOnly = { ...baseStyle, wordEmphasis: { color: '#facc15', fontWeight: 500, scale: 1 } };
    expect(resolveWordStyle(colorOnly, true)).toEqual({ color: '#facc15', fontWeight: 500, scale: 1 });

    const weightOnly = { ...baseStyle, wordEmphasis: { color: DEFAULT_HIGHLIGHT_COLOR, fontWeight: 900, scale: 1 } };
    expect(resolveWordStyle(weightOnly, true)).toEqual({ color: DEFAULT_HIGHLIGHT_COLOR, fontWeight: 900, scale: 1 });
  });
});

describe('canvasWordFont', () => {
  it('rounds the scaled font size and embeds weight and family', () => {
    expect(canvasWordFont('Inter, Arial, sans-serif', 16, { color: '#fff', fontWeight: 800, scale: 1.25 }))
      .toBe('800 20px Inter, Arial, sans-serif');
    expect(canvasWordFont('Inter, Arial, sans-serif', 32, { color: '#fff', fontWeight: 700, scale: 1.1 }))
      .toBe('700 35px Inter, Arial, sans-serif');
  });

  it('keeps the base size at scale 1', () => {
    expect(canvasWordFont('Inter, Arial, sans-serif', 32, { color: '#fff', fontWeight: 500, scale: 1 }))
      .toBe('500 32px Inter, Arial, sans-serif');
  });
});
