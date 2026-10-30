import type { CaptionStyle, TransitionType } from '../../src/types';
import type { ProjectPayload, ProjectState, SerializedClip, SerializedClipAlternative, SerializedVoiceover, SerializedVoiceoverSegment } from './types';

/**
 * Input validation for the project mutation tools.
 *
 * Hand-rolled (no schema library) so error messages name the offending path
 * (`clips[0].duration must be >= 0`) — an agent can fix its payload in one
 * round trip. Semantics and message formats mirror the projects API
 * validator (`server/projects/projectState.ts`), so a payload accepted here
 * is accepted by the API and vice versa.
 */

/** Thrown for tool arguments that violate the project contract. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
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

const TRANSITIONS: readonly TransitionType[] = ['cut', 'fade', 'dissolve', 'wipe'];
const CAPTION_MODES: readonly CaptionStyle['mode'][] = ['lower-third', 'word-highlight', 'speaker-labeled'];
const CAPTION_POSITIONS: readonly CaptionStyle['position'][] = ['bottom', 'top'];

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

/**
 * Validate and normalize an incoming ProjectState. Returns a whitelist-built
 * object: unknown keys (including browser-only `file`/`url` handles) are
 * dropped, required fields must be present and well-typed.
 */
export function parseProjectState(value: unknown): ProjectState {
  if (!isRecord(value)) throw new ValidationError('state must be an object');
  const clips = value.clips;
  if (!Array.isArray(clips)) throw new ValidationError('clips must be an array');
  return {
    clips: clips.map((clip, i) => parseClip(clip, `clips[${i}]`)),
    voiceover: parseVoiceover(value.voiceover),
    captionStyle: parseCaptionStyle(value.captionStyle),
    captionsEnabled: requireBoolean(value.captionsEnabled, 'captionsEnabled'),
  };
}

/** Validate a create/update argument object: project name plus a full ProjectState. */
export function parseProjectPayload(body: unknown): ProjectPayload {
  if (!isRecord(body)) throw new ValidationError('request body must be a JSON object');
  return {
    name: requireString(body.name, 'name'),
    state: parseProjectState(body.state),
  };
}

/** Validate a tool-supplied project id (delete, update target). */
export function parseProjectId(value: unknown): string {
  return requireString(value, 'id');
}
