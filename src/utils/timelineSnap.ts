// Pure timeline snapping math — kept free of React so it is unit-testable in isolation.
// The snap radius is defined in screen pixels and converted to seconds with the
// current pixels-per-second scale, so zooming in tightens snapping automatically.

import type { VideoClip } from '../types';

/** Default snap radius in screen pixels, independent of zoom level. */
export const DEFAULT_SNAP_THRESHOLD_PX = 8;

export type SnapTargetKind = 'origin' | 'clip-start' | 'clip-end' | 'playhead';

export interface SnapCandidate {
  /** Snap target position on the timeline, in seconds. */
  time: number;
  kind: SnapTargetKind;
}

export interface SnapResult {
  /** Position to use: the winning candidate's time when snapped, else the input. */
  time: number;
  /** The candidate that won, or null when nothing was within threshold. */
  snappedTo: SnapCandidate | null;
}

/** The parts of a clip snapping reads — structural so callers pass clips directly. */
type SnapClip = Pick<VideoClip, 'id' | 'startTime' | 'trimmedDuration' | 'duration'>;

/** Rendered on-screen duration of a clip — the width its timeline block shows. */
export function effectiveClipDuration(clip: Pick<VideoClip, 'trimmedDuration' | 'duration'>): number {
  return clip.trimmedDuration ?? clip.duration;
}

/**
 * Snap targets for a drag or trim: the timeline origin, the playhead, and every
 * other clip's start and end boundary. `excludeId` drops the clip being
 * manipulated so an edge never snaps to itself. Output is deduped and sorted
 * ascending so scoring is deterministic.
 */
export function collectSnapCandidates(clips: SnapClip[], playheadTime: number, excludeId?: string): SnapCandidate[] {
  const byTime = new Map<number, SnapCandidate>();
  const add = (time: number, kind: SnapTargetKind) => {
    // Key at nanosecond precision so float-equal boundaries dedupe to one target.
    const key = Math.round(time * 1e9) / 1e9;
    if (!byTime.has(key)) byTime.set(key, { time: key, kind });
  };
  add(0, 'origin');
  add(playheadTime, 'playhead');
  for (const clip of clips) {
    if (clip.id === excludeId) continue;
    add(clip.startTime, 'clip-start');
    add(clip.startTime + effectiveClipDuration(clip), 'clip-end');
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Closest candidate within the threshold wins; ties go to the earlier
 * candidate (candidates arrive sorted ascending). With no winner — or no
 * usable scale — the position passes through unchanged.
 */
export function findSnap(
  movingTime: number,
  candidates: SnapCandidate[],
  pixelsPerSecond: number,
  thresholdPx: number = DEFAULT_SNAP_THRESHOLD_PX,
): SnapResult {
  if (!(pixelsPerSecond > 0) || candidates.length === 0) {
    return { time: movingTime, snappedTo: null };
  }
  const thresholdSeconds = thresholdPx / pixelsPerSecond;
  let best: SnapCandidate | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.time - movingTime);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (best && bestDistance <= thresholdSeconds) {
    return { time: best.time, snappedTo: best };
  }
  return { time: movingTime, snappedTo: null };
}
