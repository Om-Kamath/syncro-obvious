import { describe, it, expect } from 'vitest';
import {
  drawCaptionOnCanvas,
  scaledCaptionFontSize,
  CAPTION_PREVIEW_REFERENCE_WIDTH,
} from './captionCanvas';
import { DEFAULT_CAPTION_STYLE } from './captionStyle';
import type { CaptionStyle } from '../types';

interface CtxCall {
  kind: 'fill' | 'fillText';
  fillStyle: string;
  text?: string;
  y?: number;
}
interface BoxCall {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Minimal 2D-context recorder — jsdom has no canvas implementation. */
function makeCtx() {
  const calls: CtxCall[] = [];
  const boxes: BoxCall[] = [];
  let fillStyle = '';
  let font = '';
  const ctx = {
    get font() { return font; },
    set font(value: string) { font = value; },
    get fillStyle() { return fillStyle; },
    set fillStyle(value: string) { fillStyle = value; },
    textAlign: '',
    measureText: (s: string) => ({ width: s.length * 10 }),
    beginPath: () => {},
    roundRect: (x: number, y: number, w: number, h: number) => { boxes.push({ x, y, w, h }); },
    rect: (x: number, y: number, w: number, h: number) => { boxes.push({ x, y, w, h }); },
    fill: () => { calls.push({ kind: 'fill', fillStyle }); },
    fillText: (text: string, _x: number, y: number) => {
      calls.push({ kind: 'fillText', fillStyle, text, y });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls, boxes, currentFont: () => font };
}

describe('scaledCaptionFontSize', () => {
  it('maps 1:1 at the preview reference width', () => {
    expect(scaledCaptionFontSize(16, CAPTION_PREVIEW_REFERENCE_WIDTH)).toBe(16);
  });

  it('scales proportionally with the export canvas width', () => {
    expect(scaledCaptionFontSize(16, 1280)).toBe(32);
    expect(scaledCaptionFontSize(24, 1080)).toBe(Math.round(24 * (1080 / 640)));
  });

  it('keeps tiny sizes legible with a floor', () => {
    expect(scaledCaptionFontSize(4, CAPTION_PREVIEW_REFERENCE_WIDTH)).toBe(12);
  });
});

describe('drawCaptionOnCanvas', () => {
  it('round-trips a custom style: family, size, colors, and bottom position', () => {
    const style: CaptionStyle = {
      ...DEFAULT_CAPTION_STYLE,
      fontFamily: 'Georgia, serif',
      fontSize: 30,
      color: '#ffee00',
      bgColor: '#101010',
      position: 'bottom',
    };
    const { ctx, calls, boxes, currentFont } = makeCtx();

    drawCaptionOnCanvas(ctx, 1280, 720, 'Hello world', style);

    expect(currentFont()).toBe(`bold ${scaledCaptionFontSize(30, 1280)}px Georgia, serif`);
    expect(calls[0]).toMatchObject({ kind: 'fill', fillStyle: '#101010' });
    const texts = calls.filter(c => c.kind === 'fillText');
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every(c => c.fillStyle === '#ffee00')).toBe(true);
    expect(texts.every(c => c.text === 'Hello world')).toBe(true);
    expect(boxes[0].y).toBeGreaterThan(720 / 2);
  });

  it('moves the caption box to the top when position is top', () => {
    const { ctx, boxes } = makeCtx();
    drawCaptionOnCanvas(ctx, 1280, 720, 'Hello world', {
      ...DEFAULT_CAPTION_STYLE,
      position: 'top',
    });
    expect(boxes[0].y).toBeLessThan(720 / 2);
  });

  it('renders nothing for empty caption text', () => {
    const { ctx, calls, boxes } = makeCtx();
    drawCaptionOnCanvas(ctx, 1280, 720, '', DEFAULT_CAPTION_STYLE);
    expect(calls).toHaveLength(0);
    expect(boxes).toHaveLength(0);
  });
});
