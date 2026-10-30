import { describe, expect, it } from 'vitest';
import { computeGifFramePlan, getTimelineDurationSec, MAX_GIF_FRAMES } from './gifExport';
import { EXPORT_PRESETS } from './exportPresets';
import { VideoClip, Voiceover } from '../types';

const WIDE = EXPORT_PRESETS.wide; // 1280×720, contain
const VERTICAL = EXPORT_PRESETS.vertical; // 1080×1920, cover

function makeClip(overrides: Partial<VideoClip> & Pick<VideoClip, 'id' | 'duration' | 'startTime'>): VideoClip {
  return {
    file: new File([], 'clip.mp4'),
    url: '',
    name: overrides.id,
    ...overrides,
  };
}

describe('computeGifFramePlan', () => {
  it('budgets one frame per duration × fps tick', () => {
    const plan = computeGifFramePlan({ durationSec: 3, fps: 10, width: 360, preset: WIDE });
    expect(plan.frameCount).toBe(30);
    expect(plan.truncated).toBe(false);
    expect(plan.exportDurationSec).toBe(3);
  });

  it('caps the frame budget at MAX_GIF_FRAMES and flags truncation', () => {
    // 60s × 15fps = 900 raw frames — well over the budget.
    const plan = computeGifFramePlan({ durationSec: 60, fps: 15, width: 360, preset: WIDE });
    expect(plan.frameCount).toBe(MAX_GIF_FRAMES);
    expect(plan.truncated).toBe(true);
    expect(plan.exportDurationSec).toBe(MAX_GIF_FRAMES / 15);
  });

  it('treats an exact-budget range as untruncated', () => {
    const plan = computeGifFramePlan({ durationSec: 30, fps: 10, width: 360, preset: WIDE });
    expect(plan.frameCount).toBe(MAX_GIF_FRAMES);
    expect(plan.truncated).toBe(false);
  });

  it('floors partial frames', () => {
    const plan = computeGifFramePlan({ durationSec: 2.05, fps: 10, width: 360, preset: WIDE });
    expect(plan.frameCount).toBe(20);
  });

  it('clamps fps into the supported range and rounds fractional input', () => {
    expect(computeGifFramePlan({ durationSec: 5, fps: 0, width: 360, preset: WIDE }).fps).toBe(1);
    expect(computeGifFramePlan({ durationSec: 5, fps: 120, width: 360, preset: WIDE }).fps).toBe(24);
    expect(computeGifFramePlan({ durationSec: 5, fps: 12.6, width: 360, preset: WIDE }).fps).toBe(13);
  });

  it('clamps width and derives height from the aspect preset', () => {
    expect(computeGifFramePlan({ durationSec: 5, fps: 10, width: 50, preset: WIDE }).width).toBe(120);
    expect(computeGifFramePlan({ durationSec: 5, fps: 10, width: 4000, preset: WIDE }).width).toBe(720);

    const wide = computeGifFramePlan({ durationSec: 5, fps: 10, width: 480, preset: WIDE });
    expect(wide.height).toBe(270); // 480 × 720/1280
    const vertical = computeGifFramePlan({ durationSec: 5, fps: 10, width: 480, preset: VERTICAL });
    expect(vertical.height).toBe(853); // 480 × 1920/1080
  });

  it('uses a uniform per-frame delay of 1000/fps ms', () => {
    expect(computeGifFramePlan({ durationSec: 3, fps: 10, width: 360, preset: WIDE }).frameDelayMs).toBe(100);
    expect(computeGifFramePlan({ durationSec: 3, fps: 24, width: 360, preset: WIDE }).frameDelayMs).toBe(42);
  });

  it('yields an empty untruncated plan for a zero-length range', () => {
    const plan = computeGifFramePlan({ durationSec: 0, fps: 10, width: 360, preset: WIDE });
    expect(plan.frameCount).toBe(0);
    expect(plan.truncated).toBe(false);
  });
});

describe('getTimelineDurationSec', () => {
  it('uses the trimmed voiceover window when a voiceover exists', () => {
    const voiceover = { url: '', duration: 120, trimStart: 10, trimEnd: 40 } as Voiceover;
    expect(getTimelineDurationSec([], voiceover)).toBe(30);
  });

  it('falls back to the chain of effective clip durations without a voiceover', () => {
    const clips = [
      makeClip({ id: 'a', duration: 5, startTime: 0 }),
      makeClip({ id: 'b', duration: 8, startTime: 5, trimmedDuration: 2 }),
    ];
    expect(getTimelineDurationSec(clips, null)).toBe(7);
  });

  it('is zero with no assets', () => {
    expect(getTimelineDurationSec([], null)).toBe(0);
  });
});
