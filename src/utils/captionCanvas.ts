import type { CaptionStyle, CaptionSegment } from '../types';
import {
  resolveWordTimings,
  findActiveWordIndex,
  WORD_HIGHLIGHT_COLOR,
  WORD_WEIGHT,
} from './wordTiming';

const FONT_STACK = 'Inter, Arial, sans-serif';

/**
 * Canvas caption renderer used during video export recording.
 *
 * In `word-highlight` mode it renders the same per-word highlighting as the
 * preview CaptionOverlay — same active-word lookup, same colors and weights —
 * by reading the shared word-timing module, so exported captions match the
 * preview at word boundaries. Other modes keep the whole-segment block
 * rendering.
 */
export function drawCaptionOnCanvas(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  seg: CaptionSegment,
  currentTime: number,
  style: CaptionStyle
) {
  const fontSize = Math.max(16, Math.round(W * 0.032));
  const maxW = W * 0.8;

  if (style.mode === 'word-highlight') {
    drawWordHighlightCaption(ctx, W, H, seg, currentTime, style, fontSize, maxW);
    return;
  }
  drawBlockCaption(ctx, W, H, seg.text, style, fontSize, maxW);
}

// ── Word-highlight mode: per-word color/weight, laid out like the preview ────
function drawWordHighlightCaption(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  seg: CaptionSegment,
  currentTime: number,
  style: CaptionStyle,
  fontSize: number,
  maxW: number
) {
  const words = resolveWordTimings(seg);
  if (words.length === 0) return;
  const activeIdx = findActiveWordIndex(words, currentTime);

  // Measure each word in the weight it will be drawn with.
  const measured = words.map((w, i) => {
    const active = i === activeIdx;
    ctx.font = `${active ? WORD_WEIGHT.active : WORD_WEIGHT.inactive} ${fontSize}px ${FONT_STACK}`;
    return { ...w, width: ctx.measureText(w.word).width, active };
  });
  ctx.font = `${WORD_WEIGHT.inactive} ${fontSize}px ${FONT_STACK}`;
  const gap = ctx.measureText(' ').width;

  // Greedy wrap into lines of words (never a widowed first word).
  const lines: Array<{ words: typeof measured; width: number }> = [];
  let cur: typeof measured = [];
  let curW = 0;
  for (const w of measured) {
    const add = cur.length === 0 ? w.width : w.width + gap;
    if (cur.length > 0 && curW + add > maxW) {
      lines.push({ words: cur, width: curW });
      cur = [w];
      curW = w.width;
    } else {
      cur.push(w);
      curW += add;
    }
  }
  if (cur.length > 0) lines.push({ words: cur, width: curW });

  const lh = fontSize * 1.35;
  const padX = 20;
  const padY = 10;
  const boxH = lines.length * lh + padY * 2;
  const maxLineWidth = lines.reduce((m, l) => Math.max(m, l.width), 0);
  const boxW = Math.min(maxLineWidth + padX * 2, W - 40);
  const boxX = (W - boxW) / 2;
  const boxY = style.position === 'bottom' ? H - boxH - 32 : 32;

  ctx.fillStyle = style.bgColor;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(boxX, boxY, boxW, boxH, 6);
  else ctx.rect(boxX, boxY, boxW, boxH);
  ctx.fill();

  ctx.textAlign = 'left';
  lines.forEach((line, li) => {
    let x = (W - line.width) / 2;
    const y = boxY + padY + (li + 0.82) * lh;
    for (const w of line.words) {
      ctx.font = `${w.active ? WORD_WEIGHT.active : WORD_WEIGHT.inactive} ${fontSize}px ${FONT_STACK}`;
      ctx.fillStyle = w.active ? WORD_HIGHLIGHT_COLOR : style.color;
      ctx.fillText(w.word, x, y);
      x += w.width + gap;
    }
  });
}

// ── Whole-segment modes: unchanged block rendering ───────────────────────────
function drawBlockCaption(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  text: string,
  style: CaptionStyle,
  fontSize: number,
  maxW: number
) {
  ctx.font = `bold ${fontSize}px ${FONT_STACK}`;
  ctx.textAlign = 'center';

  const words = text.split(' ').filter(Boolean);
  if (words.length === 0) return;
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  if (lines.length === 0) return;

  const lh = fontSize * 1.35;
  const padX = 20;
  const padY = 10;
  const boxH = lines.length * lh + padY * 2;
  const maxLineWidth = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  const boxW = Math.min(maxLineWidth + padX * 2, W - 40);
  const boxX = (W - boxW) / 2;
  const boxY = style.position === 'bottom' ? H - boxH - 32 : 32;

  ctx.fillStyle = style.bgColor;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(boxX, boxY, boxW, boxH, 6);
  else ctx.rect(boxX, boxY, boxW, boxH);
  ctx.fill();

  ctx.fillStyle = style.color;
  lines.forEach((line, i) => {
    ctx.fillText(line, W / 2, boxY + padY + (i + 0.82) * lh, maxW);
  });
}
