import type { CaptionStyle } from '../types';

/**
 * Caption sizes are authored against the preview pane. The export burn-in
 * scales them proportionally to the canvas width so a caption that reads a
 * given size in preview reads the same relative size in the exported video.
 * 640px is the preview-pane width the default size (16px) was tuned against.
 */
export const CAPTION_PREVIEW_REFERENCE_WIDTH = 640;

const MIN_EXPORT_FONT_SIZE = 12;

export function scaledCaptionFontSize(fontSize: number, canvasWidth: number): number {
  return Math.max(
    MIN_EXPORT_FONT_SIZE,
    Math.round(fontSize * (canvasWidth / CAPTION_PREVIEW_REFERENCE_WIDTH)),
  );
}

/**
 * Canvas caption renderer for the export burn-in. Extracted from
 * PostProcessingPanel so the preview/export style contract is unit-testable
 * and the panel stays UI-only.
 */
export function drawCaptionOnCanvas(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  text: string,
  style: CaptionStyle,
): void {
  const fontSize = scaledCaptionFontSize(style.fontSize, W);
  ctx.font = `bold ${fontSize}px ${style.fontFamily}`;
  ctx.textAlign = 'center';

  const maxW = W * 0.8;
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
