import { describe, it, expect } from 'vitest';
import { drawCaptionOnCanvas } from './captionCanvas';
import type { CaptionStyle } from '../types';

// Deterministic 2D-context stub: every glyph is 10px wide (spaces included).
// Draw calls snapshot the font/fillStyle active at the moment they happen so
// the test can assert exactly what the export frame composition would paint.
function makeCtx() {
  const calls = {
    fills: [] as Array<{ text: string; x: number; y: number; font: string; fillStyle: string }>,
    boxes: [] as Array<{ fillStyle: string; x?: number; y?: number; w?: number; h?: number }>,
  };
  let font = '';
  let fillStyle = '';
  let textAlign = 'start';
  const ctx = {
    get font() { return font; },
    set font(v: string) { font = v; },
    get fillStyle() { return fillStyle; },
    set fillStyle(v: string) { fillStyle = v; },
    get textAlign() { return textAlign; },
    set textAlign(v: CanvasTextAlign) { textAlign = v; },
    measureText: (t: string) => ({ width: t.length * 10, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
    fillText: (t: string, x: number, y: number) => {
      calls.fills.push({ text: t, x, y, font, fillStyle });
    },
    beginPath: () => {},
    rect: (x: number, y: number, w: number, h: number) => { calls.boxes.push({ fillStyle, x, y, w, h }); },
    roundRect: (x: number, y: number, w: number, h: number) => { calls.boxes.push({ fillStyle, x, y, w, h }); },
    fill: () => { if (calls.boxes.length === 0) calls.boxes.push({ fillStyle }); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const seg = { text: 'one two three four five', start: 0, end: 5 };

const emphasisStyle: CaptionStyle = {
  mode: 'word-highlight',
  fontSize: 28,
  color: '#ffffff',
  bgColor: 'rgba(0,0,0,0.6)',
  position: 'bottom',
  wordEmphasis: { color: '#facc15', fontWeight: 800, scale: 1.25 },
};

describe('drawCaptionOnCanvas', () => {
  it('draws each word with its resolved style during frame composition', () => {
    const { ctx, calls } = makeCtx();
    // 5 words over [0, 5] → 1s per word; t=2.5 highlights "three" (index 2).
    drawCaptionOnCanvas(ctx, 1000, 560, seg, emphasisStyle, 2.5);

    expect(calls.fills.map(f => f.text)).toEqual(['one', 'two', 'three', 'four', 'five']);

    const highlighted = calls.fills.find(f => f.text === 'three')!;
    expect(highlighted.font).toBe('800 40px Inter, Arial, sans-serif'); // round(32 * 1.25)
    expect(highlighted.fillStyle).toBe('#facc15');

    for (const f of calls.fills.filter(f => f.text !== 'three')) {
      expect(f.font).toBe('500 32px Inter, Arial, sans-serif');
      expect(f.fillStyle).toBe('#ffffff');
    }
  });

  it('lays words out left to right, centered as a line', () => {
    const { ctx, calls } = makeCtx();
    drawCaptionOnCanvas(ctx, 1000, 560, seg, emphasisStyle, 2.5);

    // 19 word chars + 4 spaces = 230px total → first word at (1000 - 230) / 2.
    expect(calls.fills[0].x).toBe(385);
    expect(calls.fills[1].x).toBe(425); // 30px word + 10px space
    expect(calls.fills[2].x).toBe(465);
    expect(calls.fills[4].y).toBe(calls.fills[0].y); // single line shares a baseline
  });

  it('paints the caption box with the background color first', () => {
    const { ctx, calls } = makeCtx();
    drawCaptionOnCanvas(ctx, 1000, 560, seg, emphasisStyle, 2.5);

    expect(calls.boxes).toHaveLength(1);
    expect(calls.boxes[0].fillStyle).toBe('rgba(0,0,0,0.6)');
    expect(calls.boxes[0].h).toBeGreaterThan(0);
  });

  it('ignores emphasis when the mode is not word-highlight', () => {
    const { ctx, calls } = makeCtx();
    const plainMode: CaptionStyle = { ...emphasisStyle, mode: 'lower-third' };
    drawCaptionOnCanvas(ctx, 1000, 560, seg, plainMode, 2.5);

    for (const f of calls.fills) {
      expect(f.font).toBe('500 32px Inter, Arial, sans-serif');
      expect(f.fillStyle).toBe('#ffffff');
    }
  });

  it('renders nothing for a segment with no words', () => {
    const { ctx, calls } = makeCtx();
    drawCaptionOnCanvas(ctx, 1000, 560, { text: '  ', start: 0, end: 5 }, emphasisStyle, 2.5);
    expect(calls.fills).toHaveLength(0);
    expect(calls.boxes).toHaveLength(0);
  });
});
