// Pure frame-accurate trim math — kept free of React and DOM so the timeline
// drag handles, keyboard trim, and ClipEditor sliders all share one testable
// implementation. Trim boundaries snap to the source video's frame grid so a
// trim made in the UI cuts exactly the frames the preview showed.

import type { VideoClip } from '../types';

/** Assumed frame rate when a clip's real fps is unknown or undetectable. */
export const DEFAULT_FPS = 30;

/** Shortest usable clip in seconds — matches the historical timeline minimum. */
export const MIN_TRIM_SECONDS = 0.5;

export interface TrimState {
  /** Seconds into the source file where playback starts. */
  trimStart: number;
  /** Playable duration (out-point minus in-point). */
  trimmedDuration: number;
  /** Full source duration; trimming never mutates it. */
  duration: number;
}

export type TrimSide = 'in' | 'out';

/** Treat any non-finite or non-positive fps as unknown. */
export function normalizeFps(fps?: number): number {
  return fps !== undefined && Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FPS;
}

/** Duration of one source frame in seconds. */
export function frameDuration(fps?: number): number {
  return 1 / normalizeFps(fps);
}

/**
 * Snap a source-file time to the nearest frame boundary. Boundaries are
 * anchored at t=0 of the source file, so in- and out-points land on the same
 * grid the decoder presents and exported cuts show the frames the preview
 * showed. Results may land exactly on 0 or on duration, which are always
 * valid cut points.
 */
export function snapToFrame(t: number, fps?: number): number {
  const rate = normalizeFps(fps);
  return Math.round(t * rate) / rate;
}

/** A clip's playable extent on the timeline (seconds). */
export function effectiveDuration(clip: Pick<VideoClip, 'trimmedDuration' | 'duration'>): number {
  return clip.trimmedDuration ?? clip.duration;
}

/**
 * Move one trim boundary by deltaSec, then snap the moved boundary to the
 * frame grid. The other boundary stays put. Clamping keeps at least
 * MIN_TRIM_SECONDS of playable material (when the source allows it) and the
 * boundary inside [0, duration]; the re-clamp after snapping covers snaps that
 * overshoot a clamp edge when duration is not itself frame-aligned.
 */
export function computeFrameTrim(state: TrimState, side: TrimSide, deltaSec: number, fps?: number): TrimState {
  const inPoint = state.trimStart;
  const outPoint = state.trimStart + state.trimmedDuration;

  if (side === 'in') {
    const maxIn = outPoint - MIN_TRIM_SECONDS;
    const snapped = snapToFrame(Math.max(0, Math.min(inPoint + deltaSec, maxIn)), fps);
    const newIn = Math.max(0, Math.min(snapped, maxIn));
    return { trimStart: newIn, trimmedDuration: outPoint - newIn, duration: state.duration };
  }

  const minOut = inPoint + MIN_TRIM_SECONDS;
  const snapped = snapToFrame(Math.max(minOut, Math.min(outPoint + deltaSec, state.duration)), fps);
  const newOut = Math.max(minOut, Math.min(snapped, state.duration));
  return { trimStart: inPoint, trimmedDuration: newOut - inPoint, duration: state.duration };
}

/**
 * Trim a clip by moving one boundary, preserving the repo convention that an
 * untrimmed clip stores `undefined` for both fields so `duration` remains the
 * single source of truth.
 */
export function applyFrameTrim(clip: VideoClip, side: TrimSide, deltaSec: number): VideoClip {
  const state = computeFrameTrim(
    {
      trimStart: clip.trimStart ?? 0,
      trimmedDuration: effectiveDuration(clip),
      duration: clip.duration,
    },
    side,
    deltaSec,
    clip.fps,
  );

  const hasTrim = state.trimStart > 0 || state.trimStart + state.trimmedDuration < clip.duration;
  return {
    ...clip,
    trimStart: state.trimStart > 0 ? state.trimStart : undefined,
    trimmedDuration: hasTrim ? state.trimmedDuration : undefined,
  };
}

/** Source frame rate for a clip, falling back to the default when undetected. */
export function clipFps(clip: Pick<VideoClip, 'fps'>): number {
  return normalizeFps(clip.fps);
}
