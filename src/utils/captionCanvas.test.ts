import { describe, it, expect } from 'vitest';
import { drawCaptionOnCanvas } from './captionCanvas';
import { WORD_HIGHLIGHT_COLOR } from './wordTiming';
import type { CaptionStyle } from '../types';

// Minimal 2D-context recorder: drawCaptionOnCanvas only needs measureText,
// fillText, path fills, and the font/fillStyle/textAlign fields. jsdom has no
// real canvas, and the assertions care about *what* is drawn per word, not
// rasterization.
function makeMockCtx(widthPerChar = 10) {
  const fillTexts: Array<{ text: string; x: number; y: number; font: string; fillStyle: string }> = [];
  const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
  let font = '';
  let fillStyle = '';
  const ctx = {
    get font() { return font; },
    set font(v: string) { font = v; },
    get fillStyle() { return fillStyle; },
    set fillStyle(v: string) { fillStyle = v; },
    textAlign: 'left',
    measureText: (s: string) => ({ width: s.length * widthPerChar }),
    fillText: (text: string, x: number, y: number) => {
      fillTexts.push({ text, x, y, font, fillStyle });
    },
    beginPath: () => {},
    rect: (x: number, y: number, w: number, h: number) => { rects.push({ x, y, w, h }); },
    fill: () => {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fillTexts, rects };
}

const wordStyle: CaptionStyle = {
  mode: 'word-highlight',
  fontSize: 24,
  color: '#ffffff',
  bgColor: 'rgba(0,0,0,0.75)',
  position: 'bottom',
};

// 4 words over [10, 14]s: each word owns exactly one second.
const seg = { text: 'alpha beta gamma delta', start: 10, end: 14 };

const drawn = (fillTexts: ReturnType<typeof makeMockCtx>['fillTexts'], word: string) => {
  const hit = fillTexts.find(f => f.text === word);
  expect(hit, `expected "${word}" to be drawn`).toBeDefined();
  return hit!;
};

describe('drawCaptionOnCanvas word-highlight timing boundaries', () => {
  it('highlights the first word mid-word and leaves the rest plain', () => {
    const { ctx, fillTexts } = makeMockCtx();
    drawCaptionOnCanvas(ctx, 1280, 720, seg, 10.5, wordStyle);

    const alpha = drawn(fillTexts, 'alpha');
    expect(alpha.fillStyle).toBe(WORD_HIGHLIGHT_COLOR);
    expect(alpha.font.startsWith('700 ')).toBe(true);

    for (const inactive of ['beta', 'gamma', 'delta']) {
      const d = drawn(fillTexts, inactive);
      expect(d.fillStyle).toBe(wordStyle.color);
      expect(d.font.startsWith('500 ')).toBe(true);
    }
  });

  it('advances the highlight exactly at each word boundary', () => {
    const cases: Array<[number, string]> = [
      [11, 'beta'],
      [12, 'gamma'],
      [13, 'delta'],
    ];
    for (const [t, activeWord] of cases) {
      const { ctx, fillTexts } = makeMockCtx();
      drawCaptionOnCanvas(ctx, 1280, 720, seg, t, wordStyle);
      expect(drawn(fillTexts, activeWord).fillStyle).toBe(WORD_HIGHLIGHT_COLOR);
      const others = ['alpha', 'beta', 'gamma', 'delta'].filter(w => w !== activeWord);
      for (const w of others) {
        expect(drawn(fillTexts, w).fillStyle).toBe(wordStyle.color);
      }
    }
  });

  it('follows real per-word timings when present, not the even-split fallback', () => {
    // Real timings with irregular gaps: "beta" owns 10.5–13.0 while the
    // even-split fallback would put each word on a neat 1s boundary. The
    // burn-in must read the same resolver as the preview.
    const realWords = [
      { word: 'alpha', start: 10, end: 10.5 },
      { word: 'beta', start: 10.5, end: 13 },
      { word: 'gamma', start: 13, end: 13.8 },
      { word: 'delta', start: 13.8, end: 14 },
    ];
    const realSeg = { ...seg, words: realWords };
    const { ctx, fillTexts } = makeMockCtx();
    drawCaptionOnCanvas(ctx, 1280, 720, realSeg, 11.5, wordStyle);
    // 11.5 sits inside "beta" under real timings but would be "gamma"
    // (floor((11.5-10)/1)=1 → index 2) under the even-split fallback.
    expect(drawn(fillTexts, 'beta').fillStyle).toBe(WORD_HIGHLIGHT_COLOR);
    for (const w of ['alpha', 'gamma', 'delta']) {
      expect(drawn(fillTexts, w).fillStyle).toBe(wordStyle.color);
    }
  });

  it('matches the preview at the edges: no highlighted word at or before segment bounds', () => {
    for (const t of [9, 14]) {
      const { ctx, fillTexts } = makeMockCtx();
      drawCaptionOnCanvas(ctx, 1280, 720, seg, t, wordStyle);
      // Same as preview: the half-open word spans leave no active word, so
      // every word renders in the base color.
      expect(fillTexts.length).toBeGreaterThan(0);
      expect(fillTexts.every(f => f.fillStyle === wordStyle.color)).toBe(true);
    }
  });

  it('keeps per-word styling when the caption wraps across lines', () => {
    // 20px/char: line1 = alpha+beta (200px), then gamma overflows maxW=256.
    const { ctx, fillTexts } = makeMockCtx(20);
    drawCaptionOnCanvas(ctx, 320, 720, seg, 10.5, wordStyle);
    expect(drawn(fillTexts, 'alpha').fillStyle).toBe(WORD_HIGHLIGHT_COLOR);
    for (const w of ['beta', 'gamma', 'delta']) {
      expect(drawn(fillTexts, w).fillStyle).toBe(wordStyle.color);
    }
  });

  it('draws the background box behind the words', () => {
    const { ctx, rects } = makeMockCtx();
    drawCaptionOnCanvas(ctx, 1280, 720, seg, 10.5, wordStyle);
    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(rects[0].w).toBeGreaterThan(0);
    expect(rects[0].h).toBeGreaterThan(0);
  });
});

describe('drawCaptionOnCanvas whole-segment modes', () => {
  it('renders one plain block per line and ignores currentTime', () => {
    const style: CaptionStyle = { ...wordStyle, mode: 'lower-third' };
    const { ctx, fillTexts } = makeMockCtx();
    drawCaptionOnCanvas(ctx, 1280, 720, seg, 11, style);
    // No wrap at this width: the whole text is a single fillText.
    expect(fillTexts).toHaveLength(1);
    expect(fillTexts[0].text).toBe('alpha beta gamma delta');
    expect(fillTexts[0].fillStyle).toBe(style.color);
  });
});
