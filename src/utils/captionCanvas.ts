import type { CaptionStyle } from '../types';
import type { CaptionSegment } from './captionUtils';
import { canvasWordFont, resolveWordStyle } from './captionEmphasis';
import { findActiveWordIndex, resolveWordTimings } from './wordTiming';

export const CAPTION_FONT_FAMILY = 'Inter, Arial, sans-serif';

const LINE_HEIGHT_FACTOR = 1.35;
const PAD_X = 20;
const PAD_Y = 10;

/**
 * Burn-in caption renderer for export frame composition. Lays out and draws
 * one word at a time (real per-word timings when the segment carries them,
 * even-split synthesis otherwise — same resolution as the preview) so the
 * highlighted word in word-highlight mode can carry its own color, weight,
 * and scale overrides from `style.wordEmphasis`. Non-highlight modes render
 * the same layout with uniform per-word styles.
 */
export function drawCaptionOnCanvas(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  seg: CaptionSegment,
  style: CaptionStyle,
  currentTime: number,
) {
  const baseFontSize = Math.max(16, Math.round(W * 0.032));
  const baseFont = `${resolveWordStyle(style, false).fontWeight} ${baseFontSize}px ${CAPTION_FONT_FAMILY}`;
  ctx.textAlign = 'left';

  const words = resolveWordTimings(seg);
  if (words.length === 0) return;
  const activeIdx = style.mode === 'word-highlight'
    ? findActiveWordIndex(words, currentTime)
    : -1;

  // Measure each word with its own resolved font so scale/weight affect layout.
  ctx.font = baseFont;
  const spaceW = ctx.measureText(' ').width;
  const tokens = words.map((w, i) => {
    const wordStyle = resolveWordStyle(style, i === activeIdx);
    const font = canvasWordFont(CAPTION_FONT_FAMILY, baseFontSize, wordStyle);
    ctx.font = font;
    return { word: w.word, wordStyle, font, width: ctx.measureText(w.word).width };
  });

  // Greedy wrap into lines of tokens.
  const maxW = W * 0.8;
  const lines: Array<Array<(typeof tokens)[number]>> = [];
  let cur: typeof lines[number] = [];
  let curW = 0;
  for (const token of tokens) {
    const w = curW + token.width + (cur.length > 0 ? spaceW : 0);
    if (w > maxW && cur.length > 0) {
      lines.push(cur);
      cur = [token];
      curW = token.width;
    } else {
      cur.push(token);
      curW = w;
    }
  }
  if (cur.length > 0) lines.push(cur);

  // Per-line height follows the largest scaled font on that line.
  const lineHeights = lines.map(line =>
    LINE_HEIGHT_FACTOR * Math.max(...line.map(t => Math.round(baseFontSize * t.wordStyle.scale))));
  const boxH = lineHeights.reduce((a, b) => a + b, 0) + PAD_Y * 2;
  const maxLineWidth = Math.max(...lines.map(line =>
    line.reduce((m, t, i) => m + t.width + (i > 0 ? spaceW : 0), 0)));
  const boxW = Math.min(maxLineWidth + PAD_X * 2, W - 40);
  const boxX = (W - boxW) / 2;
  const boxY = style.position === 'bottom' ? H - boxH - 32 : 32;

  ctx.fillStyle = style.bgColor;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(boxX, boxY, boxW, boxH, 6);
  else ctx.rect(boxX, boxY, boxW, boxH);
  ctx.fill();

  let lineTop = boxY + PAD_Y;
  lines.forEach((line, i) => {
    const lh = lineHeights[i];
    const baseline = lineTop + 0.82 * lh;
    const lineWidth = line.reduce((m, t, j) => m + t.width + (j > 0 ? spaceW : 0), 0);
    let x = (W - lineWidth) / 2;
    for (const t of line) {
      ctx.font = t.font;
      ctx.fillStyle = t.wordStyle.color;
      ctx.fillText(t.word, x, baseline);
      x += t.width + spaceW;
    }
    lineTop += lh;
  });
}
