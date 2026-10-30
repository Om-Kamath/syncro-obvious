import { describe, expect, it } from 'vitest';
import {
  clampPixelsPerSecond,
  DEFAULT_PPS,
  fitPixelsPerSecond,
  MAX_PPS,
  MIN_PPS,
  stepPixelsPerSecond,
  ZOOM_STEP_FACTOR,
} from './timelineZoom';

describe('clampPixelsPerSecond', () => {
  it('keeps values inside the range unchanged', () => {
    expect(clampPixelsPerSecond(DEFAULT_PPS)).toBe(DEFAULT_PPS);
    expect(clampPixelsPerSecond(MIN_PPS)).toBe(MIN_PPS);
    expect(clampPixelsPerSecond(MAX_PPS)).toBe(MAX_PPS);
  });

  it('clamps values outside the range', () => {
    expect(clampPixelsPerSecond(MIN_PPS - 1)).toBe(MIN_PPS);
    expect(clampPixelsPerSecond(MAX_PPS + 1)).toBe(MAX_PPS);
    expect(clampPixelsPerSecond(0)).toBe(MIN_PPS);
  });
});

describe('stepPixelsPerSecond', () => {
  it('zooms in multiplicatively and never exceeds the max', () => {
    expect(stepPixelsPerSecond(DEFAULT_PPS, 1)).toBeCloseTo(DEFAULT_PPS * ZOOM_STEP_FACTOR);
    expect(stepPixelsPerSecond(MAX_PPS, 1)).toBe(MAX_PPS);
    expect(stepPixelsPerSecond(MAX_PPS * ZOOM_STEP_FACTOR ** 5, 1)).toBe(MAX_PPS);
  });

  it('zooms out multiplicatively and never drops below the min', () => {
    expect(stepPixelsPerSecond(DEFAULT_PPS, -1)).toBeCloseTo(DEFAULT_PPS / ZOOM_STEP_FACTOR);
    expect(stepPixelsPerSecond(MIN_PPS, -1)).toBe(MIN_PPS);
    expect(stepPixelsPerSecond(MIN_PPS / ZOOM_STEP_FACTOR ** 5, -1)).toBe(MIN_PPS);
  });

  it('is symmetric: one in-step and one out-step round-trip to the start', () => {
    const out = stepPixelsPerSecond(DEFAULT_PPS, -1);
    expect(stepPixelsPerSecond(out, 1)).toBeCloseTo(DEFAULT_PPS);
  });
});

describe('fitPixelsPerSecond', () => {
  it('scales content plus headroom into the available width', () => {
    // 120s of content + 5s headroom across 1000px => 1000/125 = 8 → clamped to MIN_PPS
    expect(fitPixelsPerSecond(120, 1000)).toBe(MIN_PPS);
    // 15s of content + 5s headroom across 1000px => 50 = default scale
    expect(fitPixelsPerSecond(15, 1000)).toBeCloseTo(DEFAULT_PPS);
  });

  it('clamps the fit so short timelines never blow past the max', () => {
    // 1s of content across 2000px would naively be 333 → capped at MAX_PPS
    expect(fitPixelsPerSecond(1, 2000)).toBe(MAX_PPS);
  });

  it('falls back to the default scale when there is no content or no width', () => {
    expect(fitPixelsPerSecond(0, 1000)).toBe(DEFAULT_PPS);
    expect(fitPixelsPerSecond(30, 0)).toBe(DEFAULT_PPS);
    expect(fitPixelsPerSecond(-5, 1000)).toBe(DEFAULT_PPS);
  });

  it('keeps playhead math consistent: time * fit pps stays within the viewport width', () => {
    const contentSeconds = 45;
    const width = 900;
    const pps = fitPixelsPerSecond(contentSeconds, width);
    expect(contentSeconds * pps).toBeLessThanOrEqual(width);
  });
});
