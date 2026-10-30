import { describe, it, expect } from 'vitest';
import {
  clampClipSpeed,
  getClipSourceDuration,
  getClipTimelineDuration,
  timelineToSourceTime,
  timelineDeltaToSourceDelta,
  formatClipSpeed,
  MIN_CLIP_SPEED,
  MAX_CLIP_SPEED,
  DEFAULT_CLIP_SPEED,
  SPEED_PRESETS,
} from './clipSpeed';

describe('clampClipSpeed', () => {
  it('passes rates inside the supported range through unchanged', () => {
    expect(clampClipSpeed(1)).toBe(1);
    expect(clampClipSpeed(1.5)).toBe(1.5);
    expect(clampClipSpeed(MIN_CLIP_SPEED)).toBe(MIN_CLIP_SPEED);
    expect(clampClipSpeed(MAX_CLIP_SPEED)).toBe(MAX_CLIP_SPEED);
  });

  it('clamps below the minimum edge rate to 0.25×', () => {
    expect(clampClipSpeed(0.1)).toBe(MIN_CLIP_SPEED);
    expect(clampClipSpeed(0)).toBe(MIN_CLIP_SPEED);
    expect(clampClipSpeed(-2)).toBe(MIN_CLIP_SPEED);
  });

  it('clamps above the maximum edge rate to 4×', () => {
    expect(clampClipSpeed(10)).toBe(MAX_CLIP_SPEED);
    expect(clampClipSpeed(1000)).toBe(MAX_CLIP_SPEED);
  });

  it('falls back to the default for non-finite rates', () => {
    expect(clampClipSpeed(NaN)).toBe(DEFAULT_CLIP_SPEED);
    expect(clampClipSpeed(Infinity)).toBe(DEFAULT_CLIP_SPEED);
    expect(clampClipSpeed(-Infinity)).toBe(DEFAULT_CLIP_SPEED);
  });
});

describe('getClipSourceDuration', () => {
  it('prefers trimmedDuration and falls back to full duration', () => {
    expect(getClipSourceDuration({ duration: 10, trimmedDuration: 3 })).toBe(3);
    expect(getClipSourceDuration({ duration: 10 })).toBe(10);
  });
});

describe('getClipTimelineDuration', () => {
  it('is the identity at the default rate', () => {
    expect(getClipTimelineDuration({ duration: 10 })).toBe(10);
    expect(getClipTimelineDuration({ duration: 10, playbackRate: 1 })).toBe(10);
  });

  it('quadruples occupancy at the 0.25× minimum edge rate', () => {
    expect(getClipTimelineDuration({ duration: 10, playbackRate: 0.25 })).toBe(40);
  });

  it('quarters occupancy at the 4× maximum edge rate', () => {
    expect(getClipTimelineDuration({ duration: 10, playbackRate: 4 })).toBe(2.5);
  });

  it('combines trims with speed: occupancy = trimmedDuration ÷ rate', () => {
    expect(getClipTimelineDuration({ duration: 10, trimmedDuration: 2, playbackRate: 4 })).toBe(0.5);
    expect(getClipTimelineDuration({ duration: 10, trimmedDuration: 1, playbackRate: 0.25 })).toBe(4);
  });

  it('clamps out-of-range rates before dividing, never producing Infinity', () => {
    expect(getClipTimelineDuration({ duration: 10, playbackRate: 0 })).toBe(40);
    expect(getClipTimelineDuration({ duration: 10, playbackRate: -1 })).toBe(40);
    expect(getClipTimelineDuration({ duration: 10, playbackRate: 100 })).toBe(2.5);
    expect(getClipTimelineDuration({ duration: 10, playbackRate: NaN })).toBe(10);
  });
});

describe('timelineToSourceTime', () => {
  it('maps timeline elapsed 0 to the trim start', () => {
    expect(timelineToSourceTime({ trimStart: 2 }, 0)).toBe(2);
    expect(timelineToSourceTime({}, 0)).toBe(0);
  });

  it('is the identity mapping at the default rate', () => {
    expect(timelineToSourceTime({}, 5)).toBe(5);
    expect(timelineToSourceTime({ trimStart: 1 }, 5)).toBe(6);
  });

  it('advances media faster than the timeline at the 4× edge rate', () => {
    // 1 second of timeline consumes 4 seconds of media.
    expect(timelineToSourceTime({ playbackRate: 4 }, 1)).toBe(4);
    expect(timelineToSourceTime({ trimStart: 2, playbackRate: 4 }, 1)).toBe(6);
  });

  it('advances media slower than the timeline at the 0.25× edge rate', () => {
    // 4 seconds of timeline consume 1 second of media.
    expect(timelineToSourceTime({ playbackRate: 0.25 }, 4)).toBe(1);
    expect(timelineToSourceTime({ trimStart: 2, playbackRate: 0.25 }, 4)).toBe(3);
  });

  it('degrades to the trim start for non-finite elapsed time', () => {
    expect(timelineToSourceTime({ trimStart: 1.5 }, NaN)).toBe(1.5);
  });
});

describe('timelineDeltaToSourceDelta', () => {
  it('scales a timeline drag delta into source seconds at the rate', () => {
    expect(timelineDeltaToSourceDelta(4, 1)).toBe(4);
    expect(timelineDeltaToSourceDelta(0.25, 4)).toBe(1);
    expect(timelineDeltaToSourceDelta(undefined, 2)).toBe(2);
  });

  it('clamps a degenerate rate before scaling', () => {
    expect(timelineDeltaToSourceDelta(0, 1)).toBe(0.25);
  });
});

describe('formatClipSpeed', () => {
  it('formats rates without trailing zeros', () => {
    expect(formatClipSpeed(1)).toBe('1×');
    expect(formatClipSpeed(1.5)).toBe('1.5×');
    expect(formatClipSpeed(0.25)).toBe('0.25×');
    expect(formatClipSpeed(4)).toBe('4×');
  });
});

describe('speed presets', () => {
  it('include both edge rates and the default', () => {
    expect(SPEED_PRESETS).toContain(MIN_CLIP_SPEED);
    expect(SPEED_PRESETS).toContain(MAX_CLIP_SPEED);
    expect(SPEED_PRESETS).toContain(DEFAULT_CLIP_SPEED);
  });
});
