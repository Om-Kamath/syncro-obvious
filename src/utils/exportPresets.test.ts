import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_PRESET,
  EXPORT_PRESETS,
  computeContainGeometry,
  computeCoverGeometry,
  computeDrawGeometry,
} from './exportPresets';

describe('EXPORT_PRESETS', () => {
  it('exposes the three campaign aspect presets with correct canvas dimensions', () => {
    expect(EXPORT_PRESETS.wide).toMatchObject({ width: 1280, height: 720, fit: 'contain' });
    expect(EXPORT_PRESETS.vertical).toMatchObject({ width: 1080, height: 1920, fit: 'cover' });
    expect(EXPORT_PRESETS.square).toMatchObject({ width: 1080, height: 1080, fit: 'cover' });
  });

  it('preserves the historical 16:9 canvas as the default preset', () => {
    expect(DEFAULT_EXPORT_PRESET).toBe('wide');
    expect(EXPORT_PRESETS.wide.width / EXPORT_PRESETS.wide.height).toBeCloseTo(16 / 9);
  });

  it('hits the exact target aspect ratios', () => {
    expect(EXPORT_PRESETS.vertical.width / EXPORT_PRESETS.vertical.height).toBeCloseTo(9 / 16);
    expect(EXPORT_PRESETS.square.width / EXPORT_PRESETS.square.height).toBe(1);
  });
});

describe('computeContainGeometry', () => {
  it('fills the canvas exactly when source and canvas aspects match', () => {
    const g = computeContainGeometry(1280, 720, 1280, 720);
    expect(g).toEqual({ dx: 0, dy: 0, dWidth: 1280, dHeight: 720 });
  });

  it('letterboxes a 16:9 source into a 9:16 canvas, centered', () => {
    const g = computeContainGeometry(1280, 720, 1080, 1920);
    expect(g.dWidth).toBeCloseTo(1080);
    expect(g.dHeight).toBeCloseTo(607.5);
    expect(g.dx).toBe(0);
    expect(g.dy).toBeCloseTo((1920 - g.dHeight) / 2);
  });

  it('letterboxes a 9:16 source into the 16:9 canvas, centered', () => {
    const g = computeContainGeometry(720, 1280, 1280, 720);
    expect(g.dWidth).toBeCloseTo(405);
    expect(g.dHeight).toBeCloseTo(720);
    expect(g.dx).toBeCloseTo(437.5);
    expect(g.dy).toBe(0);
  });
});

describe('computeCoverGeometry', () => {
  it('fills a 9:16 canvas completely from 16:9 source, cropping horizontally', () => {
    const g = computeCoverGeometry(1280, 720, 1080, 1920);
    expect(g.dHeight).toBeCloseTo(1920);
    expect(g.dWidth).toBeGreaterThan(1080);
    expect(g.dx).toBeLessThan(0); // overflow hangs off both edges
    expect(g.dy).toBe(0);
  });

  it('centers the crop symmetrically for 16:9 source on the 1:1 canvas', () => {
    const g = computeCoverGeometry(1280, 720, 1080, 1080);
    expect(g.dWidth).toBeCloseTo(1920);
    expect(g.dHeight).toBeCloseTo(1080);
    expect(g.dx).toBeCloseTo(-420);
    expect(g.dy).toBe(0);
  });

  it('crops vertically (not horizontally) when the source is taller than the canvas aspect', () => {
    const g = computeCoverGeometry(720, 1280, 1080, 1080);
    expect(g.dWidth).toBeCloseTo(1080);
    expect(g.dHeight).toBeGreaterThan(1080);
    expect(g.dy).toBeLessThan(0);
    expect(g.dx).toBe(0);
  });
});

describe('computeDrawGeometry per preset', () => {
  it('wide: contain keeps the whole 16:9 frame on screen with no bars', () => {
    const g = computeDrawGeometry(EXPORT_PRESETS.wide, 1280, 720);
    expect(g).toEqual({ dx: 0, dy: 0, dWidth: 1280, dHeight: 720 });
  });

  it('wide: 4:3 source letterboxes with pillars, fully visible', () => {
    const g = computeDrawGeometry(EXPORT_PRESETS.wide, 640, 480);
    expect(g.dWidth).toBeCloseTo(960);
    expect(g.dHeight).toBeCloseTo(720);
    expect(g.dx).toBeCloseTo(160);
    expect(g.dy).toBe(0);
  });

  it('vertical: 16:9 source is smart-cropped to fill 1080x1920', () => {
    const g = computeDrawGeometry(EXPORT_PRESETS.vertical, 1280, 720);
    expect(g.dWidth).toBeGreaterThan(EXPORT_PRESETS.vertical.width);
    expect(g.dHeight).toBeGreaterThanOrEqual(EXPORT_PRESETS.vertical.height);
    expect(g.dx + g.dWidth / 2).toBeCloseTo(EXPORT_PRESETS.vertical.width / 2);
    expect(g.dy + g.dHeight / 2).toBeCloseTo(EXPORT_PRESETS.vertical.height / 2);
  });

  it('square: 16:9 source is smart-cropped to fill 1080x1080', () => {
    const g = computeDrawGeometry(EXPORT_PRESETS.square, 1280, 720);
    expect(g.dHeight).toBeCloseTo(1080);
    expect(g.dWidth).toBeCloseTo(1920);
    expect(g.dx).toBeCloseTo(-420);
    expect(g.dy).toBe(0);
  });

  it('falls back to a full-canvas stretch when video metadata is unavailable', () => {
    for (const preset of Object.values(EXPORT_PRESETS)) {
      expect(computeDrawGeometry(preset, 0, 0)).toEqual({
        dx: 0,
        dy: 0,
        dWidth: preset.width,
        dHeight: preset.height,
      });
    }
  });

  it('never under-fills the canvas on the cover presets', () => {
    const sources: Array<[number, number]> = [
      [1280, 720],
      [1920, 1080],
      [720, 1280],
      [1080, 1080],
      [640, 480],
    ];
    for (const [w, h] of sources) {
      for (const id of ['vertical', 'square'] as const) {
        const g = computeDrawGeometry(EXPORT_PRESETS[id], w, h);
        expect(g.dWidth).toBeGreaterThanOrEqual(EXPORT_PRESETS[id].width);
        expect(g.dHeight).toBeGreaterThanOrEqual(EXPORT_PRESETS[id].height);
      }
    }
  });
});
