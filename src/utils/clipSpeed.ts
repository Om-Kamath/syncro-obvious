import type { VideoClip } from '../types';

/**
 * Per-clip playback speed math.
 *
 * `playbackRate` is how fast a clip plays relative to real time: at 2× the clip
 * consumes half its source duration on the timeline, at 0.25× it consumes four
 * times as much. Every consumer of clip timing (chainClips, playhead mapping,
 * trim drags, export slicing) goes through these helpers so the three notions
 * of "clip duration" — source window, timeline occupancy, media timestamp —
 * stay consistent.
 */

export const MIN_CLIP_SPEED = 0.25;
export const MAX_CLIP_SPEED = 4;
export const DEFAULT_CLIP_SPEED = 1;

/** Slider granularity for the speed control. */
export const CLIP_SPEED_STEP = 0.05;

/** Quick-select rates offered by the clip editor (includes both edge rates). */
export const SPEED_PRESETS = [0.25, 0.5, 1, 2, 4] as const;

type SpeedSource = Pick<VideoClip, 'duration' | 'trimmedDuration' | 'playbackRate'>;
type TimeSource = Pick<VideoClip, 'trimStart' | 'playbackRate'>;

/** Clamp any input to the supported [0.25, 4] range; non-finite values fall back to the default. */
export function clampClipSpeed(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_CLIP_SPEED;
  return Math.min(MAX_CLIP_SPEED, Math.max(MIN_CLIP_SPEED, rate));
}

/** Seconds of source media the clip plays (the trim window), independent of speed. */
export function getClipSourceDuration(clip: SpeedSource): number {
  return clip.trimmedDuration ?? clip.duration;
}

/**
 * Seconds of timeline the clip occupies — source duration divided by playback
 * rate. The rate is clamped first so a degenerate stored value (0, negative,
 * non-finite) can never divide by zero or blow up the timeline.
 */
export function getClipTimelineDuration(clip: SpeedSource): number {
  const rate = clampClipSpeed(clip.playbackRate ?? DEFAULT_CLIP_SPEED);
  return getClipSourceDuration(clip) / rate;
}

/**
 * Source-media timestamp for a moment `timelineElapsed` seconds into the
 * clip's timeline occupancy: trims offset the start, rate scales the elapsed
 * time. This is the playhead mapping (preview seek) and the export slicer's
 * media-time computation in one place.
 */
export function timelineToSourceTime(clip: TimeSource, timelineElapsed: number): number {
  const rate = clampClipSpeed(clip.playbackRate ?? DEFAULT_CLIP_SPEED);
  if (!Number.isFinite(timelineElapsed)) return clip.trimStart ?? 0;
  return (clip.trimStart ?? 0) + timelineElapsed * rate;
}

/** Timeline-seconds → source-seconds delta at the given rate (for trim drags). */
export function timelineDeltaToSourceDelta(rate: number | undefined, timelineDelta: number): number {
  return timelineDelta * clampClipSpeed(rate ?? DEFAULT_CLIP_SPEED);
}

/** Format a rate for display, e.g. 1.5 → "1.5×", 0.25 → "0.25×". */
export function formatClipSpeed(rate: number): string {
  return `${Number(clampClipSpeed(rate).toFixed(2))}×`;
}
