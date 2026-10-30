import type { CaptionStyle, TransitionType, VideoClip, Voiceover } from '../types';

/**
 * JSON-safe snapshot of the editor state. `File` handles and blob object
 * URLs are deliberately dropped — they die with the page and cannot be
 * persisted; media rehydration is the saved-projects feature's job
 * (campaign PR 29), which can adopt this same snapshot shape.
 */
export interface SerializedClip {
  id: string;
  name: string;
  duration: number;
  trimmedDuration?: number;
  trimStart?: number;
  startTime: number;
  textOverlay?: string;
  track?: number;
  transitionIn?: TransitionType;
  analysis?: string;
  alternatives?: Array<{ id: string; confidence: number; reason: string }>;
}

export interface SerializedVoiceover {
  duration: number;
  trimStart?: number;
  trimEnd?: number;
  startTime?: number;
  transcription?: string;
  segments?: Array<{ text: string; start: number; end: number }>;
}

export interface ProjectSnapshot {
  version: 1;
  clips: SerializedClip[];
  voiceover: SerializedVoiceover | null;
  captionStyle: CaptionStyle;
  captionsEnabled: boolean;
}

/** localStorage record: when it was written plus the snapshot itself. */
interface StoredAutosave {
  savedAt: string;
  snapshot: ProjectSnapshot;
}

export const AUTOSAVE_STORAGE_KEY = 'syncro_autosave_v1';

/** Raised when the browser refuses the autosave write (quota, blocked storage). */
export class AutosaveStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AutosaveStorageError';
  }
}

/** Pure: reduces editor state to its persistable, JSON-safe form. */
export function buildProjectSnapshot(
  videoClips: VideoClip[],
  voiceover: Voiceover | null,
  captionStyle: CaptionStyle,
  captionsEnabled: boolean,
): ProjectSnapshot {
  return {
    version: 1,
    clips: videoClips.map((clip) => ({
      id: clip.id,
      name: clip.name,
      duration: clip.duration,
      trimmedDuration: clip.trimmedDuration,
      trimStart: clip.trimStart,
      startTime: clip.startTime,
      textOverlay: clip.textOverlay,
      track: clip.track,
      transitionIn: clip.transitionIn,
      analysis: clip.analysis,
      alternatives: clip.alternatives,
    })),
    voiceover: voiceover === null ? null : {
      duration: voiceover.duration,
      trimStart: voiceover.trimStart,
      trimEnd: voiceover.trimEnd,
      startTime: voiceover.startTime,
      transcription: voiceover.transcription,
      segments: voiceover.segments,
    },
    captionStyle,
    captionsEnabled,
  };
}

/**
 * Persists one snapshot to localStorage. Rejects with
 * `AutosaveStorageError` when the write fails so callers can surface it.
 */
export async function saveProjectSnapshot(snapshot: ProjectSnapshot): Promise<void> {
  const record: StoredAutosave = { savedAt: new Date().toISOString(), snapshot };
  try {
    localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(record));
  } catch (cause) {
    throw new AutosaveStorageError(
      'Autosave could not write to browser storage — it may be full or blocked.',
      { cause },
    );
  }
}
