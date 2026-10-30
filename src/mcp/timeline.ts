import { chainClips } from '../utils/chainClips';

/** Serializable clip fields the timeline read model consumes. */
export interface TimelineClipState {
  id: string;
  name: string;
  /** Original file duration in seconds (never mutated by trims). */
  duration: number;
  /** Effective playback duration after a right-trim; `duration` when absent. */
  trimmedDuration?: number;
  /** Seconds into the original file where playback starts; 0 when absent. */
  trimStart?: number;
  /** Stored start position; accepted for saved-state compatibility but always recomputed from array order. */
  startTime?: number;
  /** Video lane layer; 0 (default lane) when absent. */
  track?: number;
  textOverlay?: string;
  transitionIn?: string;
}

/**
 * Project-state input for the timeline read model. `id`/`name` come from the
 * project record; `clips`/`playhead` from the saved project state. Array order
 * is the timeline order — the same rule the client editor follows.
 */
export interface TimelineProjectState {
  id: string;
  name: string;
  /**
   * Persisted playhead position in seconds. The saved-projects API does not
   * persist a playhead yet, so this defaults to 0 until that field ships.
   */
  playhead?: number;
  clips: TimelineClipState[];
}

/** One clip as the get_timeline tool reports it. */
export interface TimelineClipSnapshot {
  /** 0-based position in the timeline; array order is the source of truth. */
  order: number;
  id: string;
  name: string;
  track: number;
  /** Chained start time, recomputed from array order — not the stored value. */
  startTime: number;
  /** Effective duration (trimmedDuration ?? duration) in seconds. */
  duration: number;
  /** Original source duration in seconds. */
  sourceDuration: number;
  trimStart: number;
  textOverlay: string | null;
  transitionIn: string | null;
}

/** Tool output schema for get_timeline. */
export interface TimelineSnapshot {
  projectId: string;
  name: string;
  playhead: number;
  /** End of the last clip on the timeline (sum of effective durations). */
  duration: number;
  clipCount: number;
  clips: TimelineClipSnapshot[];
}

/**
 * Pure serializer from saved project state to the get_timeline output schema.
 * Start times are recomputed from array order with the client's chainClips
 * semantics so the snapshot always matches what the editor lays out, even if
 * stored startTimes are stale; playhead defaults to 0 when not persisted.
 */
export function buildTimelineSnapshot(project: TimelineProjectState): TimelineSnapshot {
  const chained = chainClips(project.clips);

  const clips: TimelineClipSnapshot[] = chained.map((clip, order) => ({
    order,
    id: clip.id,
    name: clip.name,
    track: clip.track ?? 0,
    startTime: clip.startTime,
    duration: clip.trimmedDuration ?? clip.duration,
    sourceDuration: clip.duration,
    trimStart: clip.trimStart ?? 0,
    textOverlay: clip.textOverlay ?? null,
    transitionIn: clip.transitionIn ?? null,
  }));

  const duration = chained.reduce(
    (end, clip) => Math.max(end, clip.startTime + (clip.trimmedDuration ?? clip.duration)),
    0,
  );

  return {
    projectId: project.id,
    name: project.name,
    playhead: project.playhead ?? 0,
    duration,
    clipCount: clips.length,
    clips,
  };
}
