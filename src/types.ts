export type WorkflowMode = 'upload-both' | 'script-video' | 'video-only';

export type TransitionType = 'cut' | 'fade' | 'dissolve' | 'wipe';

export interface VideoClip {
  id: string;
  file: File;
  url: string;
  duration: number;         // original file duration (never mutated)
  trimmedDuration?: number; // effective display/playback duration after right-trim
  trimStart?: number;       // seconds into the original file to start playback (default 0)
  startTime: number;        // start time in the overall timeline
  name: string;
  analysis?: string;
  textOverlay?: string;     // optional caption shown in preview while clip is active
  track?: number;           // video track layer (0 = default, stacks vertically)
  transitionIn?: TransitionType; // transition from the previous clip into this one
  alternatives?: Array<{ id: string; confidence: number; reason: string }>; // AI-suggested alternative clips for this position
}

export interface Voiceover {
  file?: File;              // undefined for AI-generated audio
  url: string;
  duration: number;         // full original duration
  trimStart?: number;       // seconds into the audio to begin playback (default 0)
  trimEnd?: number;         // seconds into the audio to stop playback (default = duration)
  transcription?: string;
  segments?: CaptionSegment[];
  startTime?: number;
}

export interface AlignmentResult {
  videoId: string;
  startTime: number;
  reason: string;
}

export interface Chapter {
  time: number;
  label: string;
}

export interface VideoDescription {
  summary: string;
  chapters: Chapter[];
  hashtags: string[];
}

export type CaptionMode = 'lower-third' | 'word-highlight' | 'speaker-labeled';

export type CaptionPresetName = 'minimal' | 'bold-pop' | 'karaoke' | 'classic';

export interface WordTiming {
  word: string;
  start: number; // seconds, absolute on the voiceover timeline
  end: number;
}

export interface CaptionSegment {
  text: string;
  start: number;
  end: number;
  words?: WordTiming[]; // per-word timings when the transcriber provides them; absent → even-split fallback
}

export interface CaptionStyle {
  mode: CaptionMode;
  fontSize: number;
  color: string;
  bgColor: string;
  position: 'bottom' | 'top';
  preset?: CaptionPresetName; // named look this style came from; manual edits clear it
}

export interface CaptionTemplate {
  id: string;
  name: string;
  style: CaptionStyle;
  createdAt: number;
}

export interface ThumbnailCandidate {
  id: string;
  timestamp: number;
  quote: string;
  reason: string;
  imageDataUrl: string;
  source?: 'ai' | 'imported'; // absent = AI-generated candidate
}


// --- Saved projects ---------------------------------------------------------
// Metadata-only serialization of the editor state: everything JSON-safe.
// Media bytes (File objects / blob URLs) are deliberately excluded — they need
// a dedicated blob store (server or IndexedDB) and land with media-restore.

export type SerializedVideoClip = Omit<VideoClip, 'file' | 'url'>;

export type SerializedVoiceover = Omit<Voiceover, 'file' | 'url'>;

export interface ProjectSnapshot {
  clips: SerializedVideoClip[];
  voiceover: SerializedVoiceover | null;
  captionStyle: CaptionStyle;
  captionsEnabled: boolean;
}

export interface SavedProjectSummary {
  id: string;
  name: string;
  updatedAt: string; // ISO timestamp
}

export interface SavedProject extends SavedProjectSummary {
  createdAt: string; // ISO timestamp
  snapshot: ProjectSnapshot;
}
