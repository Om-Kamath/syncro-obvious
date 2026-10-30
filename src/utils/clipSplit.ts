import type { VideoClip } from '../types';

/** The two pieces produced by splitting one clip at a point. */
export interface SplitClipResult {
  /** The original clip, right-trimmed to the split point. */
  left: VideoClip;
  /** Duplicate carrying the remainder, chained immediately after `left`. */
  right: VideoClip;
}

/** Effective timeline span of a clip — the same rule chainClips and the
 * playhead-resolver use: `trimmedDuration ?? duration`. */
export function effectiveClipDuration(clip: VideoClip): number {
  return clip.trimmedDuration ?? clip.duration;
}

/**
 * Find the clip the playhead is inside. Resolution mirrors the preview's
 * active-clip effect: among covering clips, the latest-starting one wins.
 */
export function findClipAtPlayhead(clips: VideoClip[], currentTime: number): VideoClip | null {
  return (
    [...clips]
      .sort((a, b) => b.startTime - a.startTime)
      .find(c => currentTime >= c.startTime && currentTime < c.startTime + effectiveClipDuration(c)) ?? null
  );
}

/**
 * Split one clip `offset` seconds into its effective span.
 *
 * - `left` keeps the clip's identity, `trimStart`, and per-span decorations
 *   (textOverlay, transitionIn, alternatives); it is right-trimmed to `offset`.
 * - `right` is a fresh duplicate holding the remainder: it continues the same
 *   media at `trimStart + offset`, so its own `trimStart` encodes the split
 *   position and its `startTime` chains directly after `left`.
 * - `right` clears textOverlay/transitionIn/alternatives — those decorate the
 *   original span, and the right piece starts clean.
 *
 * Returns null when `offset` does not land strictly inside the span: splitting
 * at (or past) either boundary is a no-op, never a zero-length clip. When
 * `createUrl` is given it mints `right`'s blob URL so each piece independently
 * owns its URL (blob URLs are revoked per clip on delete); otherwise `right`
 * shares `left`'s URL.
 */
export function splitClip(
  clip: VideoClip,
  offset: number,
  newId: string,
  createUrl?: (clip: VideoClip) => string,
): SplitClipResult | null {
  const span = effectiveClipDuration(clip);
  if (!(offset > 0 && offset < span)) return null;

  const mediaSplit = (clip.trimStart ?? 0) + offset;
  const left: VideoClip = { ...clip, trimmedDuration: offset };
  const right: VideoClip = {
    ...clip,
    id: newId,
    url: createUrl ? createUrl(clip) : clip.url,
    trimStart: mediaSplit,
    trimmedDuration: span - offset,
    startTime: clip.startTime + offset,
    textOverlay: undefined,
    transitionIn: undefined,
    alternatives: undefined,
  };
  return { left, right };
}

/**
 * Split the clip under the playhead, replacing it in array order with the
 * left piece followed by the right (array order ≙ chainClips output).
 *
 * The two pieces together occupy exactly the original span — left keeps its
 * startTime and right ends where the original ended — so no other clip moves:
 * the chain stays contiguous by construction, on every track.
 *
 * Returns null when no clip spans the playhead or the playhead sits on a clip
 * boundary — the input array is returned unchanged in both cases.
 */
export function splitClipsAtPlayhead(
  clips: VideoClip[],
  currentTime: number,
  newId: string,
  createUrl?: (clip: VideoClip) => string,
): VideoClip[] | null {
  const active = findClipAtPlayhead(clips, currentTime);
  if (!active) return null;

  const result = splitClip(active, currentTime - active.startTime, newId, createUrl);
  if (!result) return null;

  return clips.flatMap(clip => (clip.id === active.id ? [result.left, result.right] : [clip]));
}
