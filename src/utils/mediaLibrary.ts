import type { MediaAsset, VideoClip } from '../types';

// Count how many timeline clips were instantiated from each media asset.
// Clips imported before the library existed (no assetId) are not attributed.
export function countAssetUsage(clips: Array<Pick<VideoClip, 'assetId'>>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const clip of clips) {
    if (!clip.assetId) continue;
    counts[clip.assetId] = (counts[clip.assetId] ?? 0) + 1;
  }
  return counts;
}

// Build a fresh timeline instance from a library asset: the clip shares the
// asset's media (file/blob URL), but timeline-specific state — position,
// trims, overlay, track, transition, AI alternatives — starts clean.
export function clipFromAsset(asset: MediaAsset, id: string): VideoClip {
  return {
    id,
    file: asset.file,
    url: asset.url,
    duration: asset.duration,
    startTime: 0,
    name: asset.name,
    assetId: asset.id,
  };
}
