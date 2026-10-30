import { describe, expect, it } from 'vitest';
import {
  applyFrameTrim,
  clipFps,
  computeFrameTrim,
  DEFAULT_FPS,
  effectiveDuration,
  frameDuration,
  MIN_TRIM_SECONDS,
  normalizeFps,
  snapToFrame,
} from './trimMath';
import type { VideoClip } from '../types';

const FPS = 30;

function makeClip(overrides: Partial<VideoClip> = {}): VideoClip {
  return {
    id: 'clip-1',
    file: new File([], 'clip.mp4'),
    url: 'blob:clip-1',
    duration: 3,
    startTime: 0,
    name: 'clip.mp4',
    ...overrides,
  };
}

describe('normalizeFps', () => {
  it('passes through positive finite rates', () => {
    expect(normalizeFps(24)).toBe(24);
    expect(normalizeFps(29.97)).toBe(29.97);
  });

  it('falls back to the default for unknown rates', () => {
    expect(normalizeFps(undefined)).toBe(DEFAULT_FPS);
    expect(normalizeFps(0)).toBe(DEFAULT_FPS);
    expect(normalizeFps(-30)).toBe(DEFAULT_FPS);
    expect(normalizeFps(Number.NaN)).toBe(DEFAULT_FPS);
    expect(normalizeFps(Number.POSITIVE_INFINITY)).toBe(DEFAULT_FPS);
  });
});

describe('frameDuration', () => {
  it('is the reciprocal of the frame rate', () => {
    expect(frameDuration(30)).toBeCloseTo(1 / 30);
    expect(frameDuration(24)).toBeCloseTo(1 / 24);
  });

  it('falls back to the default rate for unknown fps', () => {
    expect(frameDuration(undefined)).toBeCloseTo(1 / DEFAULT_FPS);
  });
});

describe('snapToFrame', () => {
  it('keeps times already on the frame grid', () => {
    expect(snapToFrame(0, FPS)).toBe(0);
    expect(snapToFrame(0.1, FPS)).toBeCloseTo(0.1);
    expect(snapToFrame(2.5, FPS)).toBeCloseTo(2.5);
  });

  it('moves off-grid times to the nearest boundary', () => {
    // 0.04s * 30 = 1.2 frames → frame 1.
    expect(snapToFrame(0.04, FPS)).toBeCloseTo(1 / 30);
    // 0.05s * 30 = 1.5 frames → rounds up to frame 2.
    expect(snapToFrame(0.05, FPS)).toBeCloseTo(2 / 30);
  });

  it('honors the clip frame rate, including fractional rates', () => {
    expect(snapToFrame(0.05, 24)).toBeCloseTo(1 / 24);
    expect(snapToFrame(0.05, 29.97)).toBeCloseTo(1 / 29.97);
  });

  it('is idempotent', () => {
    const once = snapToFrame(0.04, FPS);
    expect(snapToFrame(once, FPS)).toBeCloseTo(once);
  });
});

describe('effectiveDuration', () => {
  it('prefers the trimmed duration when present', () => {
    expect(effectiveDuration({ trimmedDuration: 2, duration: 10 })).toBe(2);
  });

  it('falls back to the full duration for untrimmed clips', () => {
    expect(effectiveDuration({ trimmedDuration: undefined, duration: 10 })).toBe(10);
  });
});

describe('computeFrameTrim — in-point', () => {
  const state = { trimStart: 0, trimmedDuration: 3, duration: 3 };

  it('moves the in-point and keeps the out-point fixed', () => {
    const next = computeFrameTrim(state, 'in', 0.1, FPS);
    expect(next.trimStart).toBeCloseTo(0.1);
    expect(next.trimStart + next.trimmedDuration).toBeCloseTo(3); // out-point unmoved
    expect(next.trimmedDuration).toBeCloseTo(2.9);
    expect(next.duration).toBe(3);
  });

  it('snaps to the nearest frame grid line', () => {
    // 0.045s = 1.35 frames → frame 1.
    const next = computeFrameTrim(state, 'in', 0.045, FPS);
    expect(next.trimStart).toBeCloseTo(1 / 30);
    // Sub-frame deltas within the same frame are absorbed.
    const stuck = computeFrameTrim(state, 'in', 0.01, FPS);
    expect(stuck.trimStart).toBe(0);
  });

  it('never lets the in-point pass the out-point minus the minimum', () => {
    const next = computeFrameTrim(state, 'in', 5, FPS);
    expect(next.trimStart).toBeCloseTo(3 - MIN_TRIM_SECONDS);
    expect(next.trimmedDuration).toBeCloseTo(MIN_TRIM_SECONDS);
  });

  it('never lets the in-point go below zero', () => {
    const next = computeFrameTrim(state, 'in', -5, FPS);
    expect(next.trimStart).toBe(0);
    expect(next.trimmedDuration).toBeCloseTo(3);
  });

  it('re-clamps after a snap overshoots the minimum-duration edge', () => {
    // maxIn = 0.5 (15 frames), but 0.52s snaps to frame 16 = 0.533s.
    const cramped = { trimStart: 0.5, trimmedDuration: 0.5, duration: 3 };
    const next = computeFrameTrim(cramped, 'in', 0.02, FPS);
    expect(next.trimStart).toBeCloseTo(0.5);
    expect(next.trimmedDuration).toBeCloseTo(0.5);
  });

  it('respects the clip frame rate', () => {
    const next = computeFrameTrim(state, 'in', 0.05, 24);
    expect(next.trimStart).toBeCloseTo(1 / 24);
  });
});

describe('computeFrameTrim — out-point', () => {
  const state = { trimStart: 0, trimmedDuration: 3, duration: 3 };

  it('moves the out-point and keeps the in-point fixed', () => {
    const next = computeFrameTrim(state, 'out', -0.1, FPS);
    expect(next.trimStart).toBe(0);
    expect(next.trimmedDuration).toBeCloseTo(2.9);
  });

  it('snaps to the nearest frame grid line', () => {
    // 3.0 - 0.005 = 2.995s = 89.85 frames → frame 90 → no visible change;
    // 3.0 - 0.02 = 2.98s = 89.4 frames → frame 89.
    const next = computeFrameTrim(state, 'out', -0.02, FPS);
    expect(next.trimStart + next.trimmedDuration).toBeCloseTo(89 / 30);
  });

  it('never extends past the source duration', () => {
    const next = computeFrameTrim(state, 'out', 5, FPS);
    expect(next.trimStart + next.trimmedDuration).toBeCloseTo(3);
  });

  it('clamps to the raw duration when it is not frame-aligned', () => {
    const ragged = { trimStart: 0, trimmedDuration: 3.32, duration: 3.32 };
    const extended = computeFrameTrim(ragged, 'out', 5, FPS);
    // 3.32s = 99.6 frames snaps to frame 100 (3.333s) but must stay ≤ 3.32s.
    expect(extended.trimStart + extended.trimmedDuration).toBeCloseTo(3.32);

    // Trimming inward from a ragged edge lands on the last full frame.
    const trimmed = computeFrameTrim(ragged, 'out', -0.005, FPS);
    expect(trimmed.trimStart + trimmed.trimmedDuration).toBeCloseTo(3.3);
  });

  it('never lets the out-point pass the in-point plus the minimum', () => {
    const next = computeFrameTrim(state, 'out', -5, FPS);
    expect(next.trimStart + next.trimmedDuration).toBeCloseTo(MIN_TRIM_SECONDS);
    expect(next.trimmedDuration).toBeCloseTo(MIN_TRIM_SECONDS);
  });
});

describe('computeFrameTrim — invariants', () => {
  it('pins the moved boundary to the frame grid or a clamp edge, and keeps the other fixed', () => {
    const rate = 24;
    const start = { trimStart: 0.3, trimmedDuration: 2.7, duration: 3 };
    const inPoint = start.trimStart;
    const outPoint = start.trimStart + start.trimmedDuration;
    const toFrames = (t: number) => t * rate;
    const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
    const onGrid = (t: number) => near(toFrames(t), Math.round(toFrames(t)), 1e-9);

    for (let step = -12; step <= 12; step++) {
      for (const side of ['in', 'out'] as const) {
        const next = computeFrameTrim(start, side, step / 10, rate);

        if (side === 'in') {
          // Moved boundary: on-grid, or pinned to 0 / out-point minus minimum.
          expect(
            onGrid(next.trimStart) ||
            near(toFrames(next.trimStart), 0) ||
            near(toFrames(next.trimStart), toFrames(outPoint - MIN_TRIM_SECONDS)),
          ).toBe(true);
          // Unmoved boundary stays at the out-point.
          expect(near(next.trimStart + next.trimmedDuration, outPoint)).toBe(true);
        } else {
          // Moved boundary: on-grid, or pinned to duration / in-point plus minimum.
          const out = next.trimStart + next.trimmedDuration;
          expect(
            onGrid(out) ||
            near(toFrames(out), toFrames(start.duration)) ||
            near(toFrames(out), toFrames(inPoint + MIN_TRIM_SECONDS)),
          ).toBe(true);
          // Unmoved boundary stays at the in-point.
          expect(next.trimStart).toBeCloseTo(inPoint);
        }

        expect(next.trimStart).toBeGreaterThanOrEqual(0);
        expect(next.trimStart + next.trimmedDuration).toBeLessThanOrEqual(next.duration + 1e-9);
        expect(next.trimmedDuration).toBeGreaterThanOrEqual(
          Math.min(MIN_TRIM_SECONDS, next.duration) - 1e-9,
        );
      }
    }
  });
});

describe('applyFrameTrim', () => {
  it('leaves an untrimmed clip untrimmed when the move snaps back to full length', () => {
    const clip = makeClip({ duration: 3 });
    const next = applyFrameTrim(clip, 'out', 0);
    expect(next.trimStart).toBeUndefined();
    expect(next.trimmedDuration).toBeUndefined();
  });

  it('stores a left trim as trimStart plus trimmedDuration', () => {
    const next = applyFrameTrim(makeClip({ duration: 3 }), 'in', 0.1);
    expect(next.trimStart).toBeCloseTo(0.1);
    expect(next.trimmedDuration).toBeCloseTo(2.9);
  });

  it('clears trimStart when the in-point returns to zero', () => {
    const trimmed = makeClip({ duration: 3, trimStart: 0.1, trimmedDuration: 2.9 });
    const next = applyFrameTrim(trimmed, 'in', -0.1);
    expect(next.trimStart).toBeUndefined();
    expect(next.trimmedDuration).toBeUndefined();
  });

  it('clears trimmedDuration when the out-point returns to full length', () => {
    const trimmed = makeClip({ duration: 3, trimStart: undefined, trimmedDuration: 2.9 });
    const next = applyFrameTrim(trimmed, 'out', 0.1);
    expect(next.trimStart).toBeUndefined();
    expect(next.trimmedDuration).toBeUndefined();
  });

  it('keeps a ragged-duration clip marked as trimmed on the last full frame', () => {
    const ragged = makeClip({ duration: 3.32 });
    const next = applyFrameTrim(ragged, 'out', -0.02);
    expect(next.trimStart).toBeUndefined();
    expect(next.trimmedDuration).toBeCloseTo(3.3);
  });

  it('uses the clip fps and preserves unrelated fields', () => {
    const clip = makeClip({ duration: 3, fps: 24, name: 'a.mp4' });
    const next = applyFrameTrim(clip, 'in', 0.05);
    expect(next.trimStart).toBeCloseTo(1 / 24);
    expect(next.name).toBe('a.mp4');
    expect(next.fps).toBe(24);
  });
});

describe('clipFps', () => {
  it('returns the detected rate or the default', () => {
    expect(clipFps({ fps: 60 })).toBe(60);
    expect(clipFps({ fps: undefined })).toBe(DEFAULT_FPS);
  });
});
