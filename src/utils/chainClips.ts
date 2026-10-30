import type { VideoClip } from '../types';
import { getClipTimelineDuration } from './clipSpeed';

interface ChainableClip {
  duration: number;
  trimmedDuration?: number;
  playbackRate?: number;
}

// Lay clips out back-to-back: each clip's startTime is the cumulative total of
// the preceding clips' timeline occupancy — the trimmed source window divided
// by the clip's playback rate when one is set. Generic so the server-side
// timeline read model reuses the exact same math.
export function chainClips<T extends ChainableClip>(clips: T[]): Array<T & { startTime: number }> {
  if (clips.length === 0) return [];
  let cursor = 0;
  return clips.map(clip => {
    const positioned: T & { startTime: number } = Object.assign({}, clip, { startTime: cursor });
    cursor += getClipTimelineDuration(clip);
    return positioned;
  });
}

// Remove any of the given clips (unknown ids are ignored) and close the gaps
// they leave: remaining clips keep their relative order and rechain
// back-to-back. Nothing matched → same array, untouched.
export function rippleDeleteMany(clips: VideoClip[], ids: string[]): VideoClip[] {
  const idSet = new Set(ids);
  const remaining = clips.filter(clip => !idSet.has(clip.id));
  if (remaining.length === clips.length) return clips;
  return chainClips(remaining);
}

// Remove a clip and close the gap it leaves: remaining clips keep their
// relative order and rechain back-to-back, shifting everything after the
// deleted clip left. Unknown id is a no-op (same array, untouched).
export function rippleDelete(clips: VideoClip[], id: string): VideoClip[] {
  return rippleDeleteMany(clips, [id]);
}
