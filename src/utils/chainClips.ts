interface ChainableClip {
  duration: number;
  trimmedDuration?: number;
}

// Lay clips out back-to-back: each clip's startTime is the cumulative total of
// the preceding clips' effective durations (trimmedDuration ?? duration).
// Generic so the server-side timeline read model reuses the exact same math.
export function chainClips<T extends ChainableClip>(clips: T[]): Array<T & { startTime: number }> {
  if (clips.length === 0) return [];
  let cursor = 0;
  return clips.map(clip => {
    const positioned: T & { startTime: number } = Object.assign({}, clip, { startTime: cursor });
    cursor += clip.trimmedDuration ?? clip.duration;
    return positioned;
  });
}
