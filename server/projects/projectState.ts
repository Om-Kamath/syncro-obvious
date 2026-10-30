import type { CaptionStyle, TransitionType } from '../../src/types';

/**
 * Serialized project state — the JSON-safe projection of the editor state a
 * saved project stores (code map §5). Browser-only handles are excluded by
 * construction: `VideoClip.file`/`url` and `Voiceover.file`/`url` never reach
 * this shape because validation whitelists known fields and drops the rest.
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

/** Thrown for payloads that violate the project contract; maps to HTTP 400. */
export class ValidationError extends Error {
  readonly status = 400 as const;

  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Create and update share one payload shape: `{ name, state }`. */
export interface ProjectPayload {
  name: string;
  state: ProjectState;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${path} must be a non-empty string`);
  }
  return value;
}

/** Free-form string field: any string accepted when present (may be empty). */
function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ValidationError(`${path} must be a string`);
  return value;
}

function requireNumber(value: unknown, path: string, min?: number, max?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${path} must be a finite number`);
  }
  if (min !== undefined && value < min) throw new ValidationError(`${path} must be >= ${min}`);
  if (max !== undefined && value > max) throw new ValidationError(`${path} must be <= ${max}`);
  return value;
}

function optionalNumber(value: unknown, path: string, min?: number, max?: number): number | undefined {
  return value === undefined ? undefined : requireNumber(value, path, min, max);
}

function optionalInteger(value: unknown, path: string, min?: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`${path} must be an integer`);
  }
  if (min !== undefined && value < min) throw new ValidationError(`${path} must be >= ${min}`);
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ValidationError(`${path} must be a boolean`);
  return value;
}

function requireOneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new ValidationError(`${path} must be one of: ${allowed.join(', ')}`);
  }
  return match;
}

const TRANSITIONS = ['cut', 'fade', 'dissolve', 'wipe'] as const;
const CAPTION_MODES = ['lower-third', 'word-highlight', 'speaker-labeled'] as const;
const CAPTION_POSITIONS = ['bottom', 'top'] as const;

function parseCaptionStyle(value: unknown): CaptionStyle {
  if (!isRecord(value)) throw new ValidationError('captionStyle must be an object');
  const fontSize = requireNumber(value.fontSize, 'captionStyle.fontSize');
  if (fontSize <= 0) throw new ValidationError('captionStyle.fontSize must be > 0');
  return {
    mode: requireOneOf(value.mode, 'captionStyle.mode', CAPTION_MODES),
    fontSize,
    color: requireString(value.color, 'captionStyle.color'),
    bgColor: requireString(value.bgColor, 'captionStyle.bgColor'),
    position: requireOneOf(value.position, 'captionStyle.position', CAPTION_POSITIONS),
  };
}

function parseSegments(value: unknown): SerializedVoiceoverSegment[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ValidationError('voiceover.segments must be an array');
  return value.map((segment, i) => {
    const path = `voiceover.segments[${i}]`;
    if (!isRecord(segment)) throw new ValidationError(`${path} must be an object`);
    const start = requireNumber(segment.start, `${path}.start`, 0);
    const end = requireNumber(segment.end, `${path}.end`, 0);
    if (start > end) throw new ValidationError(`${path}.start must be <= ${path}.end`);
    return {
      text: requireString(segment.text, `${path}.text`),
      start,
      end,
    };
  });
}

function parseVoiceover(value: unknown): SerializedVoiceover | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new ValidationError('voiceover must be an object or null');
  return {
    duration: requireNumber(value.duration, 'voiceover.duration', 0),
    trimStart: optionalNumber(value.trimStart, 'voiceover.trimStart', 0),
    trimEnd: optionalNumber(value.trimEnd, 'voiceover.trimEnd', 0),
    transcription: optionalString(value.transcription, 'voiceover.transcription'),
    segments: parseSegments(value.segments),
    startTime: optionalNumber(value.startTime, 'voiceover.startTime', 0),
  };
}

function parseAlternatives(value: unknown, parentPath: string): SerializedClipAlternative[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ValidationError(`${parentPath} must be an array`);
  return value.map((alternative, i) => {
    const path = `${parentPath}[${i}]`;
    if (!isRecord(alternative)) throw new ValidationError(`${path} must be an object`);
    return {
      id: requireString(alternative.id, `${path}.id`),
      confidence: requireNumber(alternative.confidence, `${path}.confidence`, 0, 1),
      reason: requireString(alternative.reason, `${path}.reason`),
    };
  });
}

function parseClip(value: unknown, path: string): SerializedClip {
  if (!isRecord(value)) throw new ValidationError(`${path} must be an object`);
  return {
    id: requireString(value.id, `${path}.id`),
    name: requireString(value.name, `${path}.name`),
    duration: requireNumber(value.duration, `${path}.duration`, 0),
    startTime: requireNumber(value.startTime, `${path}.startTime`, 0),
    trimmedDuration: optionalNumber(value.trimmedDuration, `${path}.trimmedDuration`, 0),
    trimStart: optionalNumber(value.trimStart, `${path}.trimStart`, 0),
    textOverlay: optionalString(value.textOverlay, `${path}.textOverlay`),
    track: optionalInteger(value.track, `${path}.track`, 0),
    transitionIn:
      value.transitionIn === undefined
        ? undefined
        : requireOneOf(value.transitionIn, `${path}.transitionIn`, TRANSITIONS),
    analysis: optionalString(value.analysis, `${path}.analysis`),
    alternatives: parseAlternatives(value.alternatives, `${path}.alternatives`),
  };
}

function parseClips(value: unknown): SerializedClip[] {
  if (!Array.isArray(value)) throw new ValidationError('clips must be an array');
  return value.map((clip, i) => parseClip(clip, `clips[${i}]`));
}

/**
 * Validate and normalize an incoming ProjectState. Returns a whitelist-built
 * object: unknown keys (including browser-only `file`/`url` handles) are
 * dropped, required fields must be present and well-typed.
 */
export function parseProjectState(value: unknown): ProjectState {
  if (!isRecord(value)) throw new ValidationError('state must be an object');
  return {
    clips: parseClips(value.clips),
    voiceover: parseVoiceover(value.voiceover),
    captionStyle: parseCaptionStyle(value.captionStyle),
    captionsEnabled: requireBoolean(value.captionsEnabled, 'captionsEnabled'),
  };
}

/** Validate a POST/PUT body: project name plus a full ProjectState. */
export function parseProjectPayload(body: unknown): ProjectPayload {
  if (!isRecord(body)) throw new ValidationError('request body must be a JSON object');
  return {
    name: requireString(body.name, 'name'),
    state: parseProjectState(body.state),
  };
}
