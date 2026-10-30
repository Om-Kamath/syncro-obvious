import type { CaptionStyle } from '../types';

// Built-in highlight look, preserved from the pre-emphasis behavior so an
// undefined `wordEmphasis` renders exactly as before.
export const DEFAULT_HIGHLIGHT_COLOR = '#7c3aed';
export const BASE_WORD_WEIGHT = 500;
export const DEFAULT_HIGHLIGHT_WEIGHT = 700;
export const DEFAULT_HIGHLIGHT_SCALE = 1;

export interface WordStyle {
  color: string;
  fontWeight: number;
  scale: number;
}

/** Non-empty word tokens; the single token list shared by preview and export. */
export function splitWords(text: string): string[] {
  return text.split(' ').filter(Boolean);
}

/**
 * Index of the highlighted word within a segment at `currentTime`, using the
 * even-split timing model (each word owns (end - start) / wordCount seconds).
 * Returns -1 when nothing should be highlighted: empty text, degenerate
 * segment, or a time outside the segment's word range.
 */
export function activeWordIndex(
  text: string,
  start: number,
  end: number,
  currentTime: number,
): number {
  const words = splitWords(text);
  const count = words.length;
  if (count === 0) return -1;
  const wordDur = (end - start) / count;
  if (!(wordDur > 0)) return -1;
  const idx = Math.floor((currentTime - start) / wordDur);
  if (idx < 0 || idx >= count) return -1;
  return idx;
}

/**
 * Per-word style resolution: the highlighted word takes the user's
 * `wordEmphasis` overrides (falling back to the built-in highlight defaults
 * per field); every other word renders with the base caption color at rest
 * weight and scale.
 */
export function resolveWordStyle(style: CaptionStyle, isHighlighted: boolean): WordStyle {
  if (!isHighlighted) {
    return { color: style.color, fontWeight: BASE_WORD_WEIGHT, scale: 1 };
  }
  const e = style.wordEmphasis;
  return {
    color: e?.color ?? DEFAULT_HIGHLIGHT_COLOR,
    fontWeight: e?.fontWeight ?? DEFAULT_HIGHLIGHT_WEIGHT,
    scale: e?.scale ?? DEFAULT_HIGHLIGHT_SCALE,
  };
}

/** Canvas font string for a word, applying the word's scale to the base font size. */
export function canvasWordFont(family: string, baseFontSize: number, wordStyle: WordStyle): string {
  const px = Math.max(1, Math.round(baseFontSize * wordStyle.scale));
  return `${wordStyle.fontWeight} ${px}px ${family}`;
}
