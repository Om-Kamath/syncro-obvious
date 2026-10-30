import { CaptionStyle } from '../types';

/**
 * Canvas caption renderer shared by the video exporter and the GIF renderer so
 * burned-in captions look identical in both outputs.
 */
export function drawCaptionOnCanvas(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  text: string,
  style: CaptionStyle
) {
  const fontSize = Math.max(16, Math.round(W * 0.032));
  ctx.font = `bold ${fontSize}px Inter, Arial, sans-serif`;
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
