import type { VideoClip } from '../types';

// Lay clips out back-to-back: each clip's startTime is the cumulative total of
// the preceding clips' effective durations (trimmedDuration ?? duration).
export function chainClips(clips: VideoClip[]): VideoClip[] {
  if (clips.length === 0) return [];
  let cursor = 0;
  return clips.map(clip => {
    const positioned = { ...clip, startTime: cursor };
    cursor += clip.trimmedDuration ?? clip.duration;
    return positioned;
  });
}
