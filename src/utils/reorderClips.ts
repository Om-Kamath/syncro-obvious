import type { VideoClip } from '../types';
import { chainClips } from './chainClips';

// Effective play duration — matches chainClips' layout math.
const effectiveDuration = (clip: VideoClip) => clip.trimmedDuration ?? clip.duration;

/**
 * Reorder the clip sequence by dropping one block at `dropTime` seconds.
 *
 * Array order is the source of truth for the sequence: the dragged clip is
 * inserted before the first remaining clip whose centre it was dropped past
 * (so a block must cross a neighbour's midpoint to jump ahead of it), and
 * every startTime is rechained back-to-back via chainClips. Rechaining also
 * heals any divergence between array order and startTime order on drop.
 *
 * The dragged clip's own startTime is ignored and reassigned; its track is
 * preserved. Returns the input array unchanged (same reference) when no clip
 * matches draggedId.
 */
export function reorderClips(clips: VideoClip[], draggedId: string, dropTime: number): VideoClip[] {
  const dragged = clips.find(clip => clip.id === draggedId);
  if (!dragged) return clips;

  const others = clips
    .filter(clip => clip.id !== draggedId)
    .sort((a, b) => a.startTime - b.startTime); // stable sort: ties keep current array order

  let targetIndex = others.length;
  for (let i = 0; i < others.length; i++) {
    if (dropTime < others[i].startTime + effectiveDuration(others[i]) / 2) {
      targetIndex = i;
      break;
    }
  }

  return chainClips([...others.slice(0, targetIndex), dragged, ...others.slice(targetIndex)]);
}
