import type { CaptionStyle } from '../types';

/**
 * Default caption look. Matches the values hard-coded in the preview and
 * export renderers before the style editor existed, so captions render
 * unchanged until the user customizes them.
 */
export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  mode: 'lower-third',
  fontFamily: 'Inter, Arial, sans-serif',
  fontSize: 16,
  color: '#ffffff',
  bgColor: '#000000',
  position: 'bottom',
  wordHighlightColor: '#7c3aed',
};

export interface CaptionFontOption {
  label: string;
  value: string;
}

/**
 * Curated font stacks that work both in the DOM and in the canvas font
 * shorthand (`ctx.font = "bold 32px <value>"`), so preview and export
 * burn-in resolve the same face.
 */
export const CAPTION_FONT_OPTIONS: CaptionFontOption[] = [
  { label: 'Inter', value: 'Inter, Arial, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Comic Sans', value: '"Comic Sans MS", cursive' },
];

/**
 * A style restored from a template or project may name a family outside the
 * curated list. Keep it selectable instead of letting the select silently
 * snap to the first option.
 */
export function ensureFontOption(
  options: CaptionFontOption[],
  value: string,
): CaptionFontOption[] {
  if (options.some(option => option.value === value)) return options;
  const familyName = value.split(',')[0].replace(/["']/g, '').trim();
  return [{ label: familyName || 'Custom', value }, ...options];
}
