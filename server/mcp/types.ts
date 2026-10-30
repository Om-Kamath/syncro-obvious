import type { CaptionStyle, TransitionType } from '../../src/types';

/**
 * Serialized-project shapes shared by the MCP tools. These mirror the REST
 * contract served by the projects API (see `server/projects/projectState.ts`
 * on the projects-api branch); keep them in sync until the two merge into one
 * shared module.
 */
export interface SerializedClipAlternative {
  id: string;
  confidence: number;
  reason: string;
}

export interface SerializedClip {
  id: string;
  name: string;
  /** Original file duration in seconds (never mutated by trims). */
  duration: number;
  /** Start time in the overall timeline. Array order is the source of truth for ordering. */
  startTime: number;
  trimmedDuration?: number;
  trimStart?: number;
  textOverlay?: string;
  track?: number;
  transitionIn?: TransitionType;
  analysis?: string;
  alternatives?: SerializedClipAlternative[];
}

export interface SerializedVoiceoverSegment {
  text: string;
  start: number;
  end: number;
}

export interface SerializedVoiceover {
  duration: number;
  trimStart?: number;
  trimEnd?: number;
  transcription?: string;
  segments?: SerializedVoiceoverSegment[];
  startTime?: number;
}

export interface ProjectState {
  clips: SerializedClip[];
  /** Null when the project has no voiceover yet; omitted on input is treated as null. */
  voiceover: SerializedVoiceover | null;
  captionStyle: CaptionStyle;
  captionsEnabled: boolean;
}

/** Create and update share one payload shape: `{ name, state }`. */
export interface ProjectPayload {
  name: string;
  state: ProjectState;
}

// Type alias (not interface): aliases get implicit index signatures, so a
// ProjectRecord satisfies MCP's `structuredContent: Record<string, unknown>`
// without a cast.
export type ProjectRecord = {
  id: string;
  name: string;
  state: ProjectState;
  createdAt: string;
  updatedAt: string;
};
