import type { ProjectStatePayload, SerializedClip, SerializedVoiceover } from './apiClient';
import type { CaptionStyle } from '../../src/types';
import { ToolFailure } from './results';

/**
 * Deep input validation for the project mutation tools.
 *
 * The Syncro server currently performs no ProjectState validation of its own
 * (see `server/app.ts`), and MCP callers reach it without the browser UI's
 * editor invariants. This module is the write-path gate: it turns arbitrary
 * JSON-RPC arguments into a normalized `ProjectStatePayload` or a
 * `StateValidationFailure` whose message names the offending path
 * (`clips[0].duration must be >= 0`) so an agent can fix its own input.
 */

/** Expected validation failure — rendered as an `isError` tool result. */
export class StateValidationFailure extends ToolFailure {}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function nonEmptyString(value: unknown, path: string): string {
  if (!isNonEmptyString(value)) {
    throw new StateValidationFailure(`${path} must be a non-empty string`);
  }
  return value;
}

function nonNegativeNumber(value: unknown, path: string): number {
  if (!isFiniteNumber(value) || value < 0) {
    throw new StateValidationFailure(`${path} must be >= 0`);
  }
  return value;
}

function optionalNonNegativeNumber(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  return nonNegativeNumber(value, path);
}

const TRANSITIONS = ['cut', 'fade', 'dissolve', 'wipe'] as const;
const CAPTION_MODES = ['lower-third', 'word-highlight', 'speaker-labeled'] as const;
const CAPTION_POSITIONS = ['bottom', 'top'] as const;

/** Prove membership and return the narrowed literal type. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new StateValidationFailure(`${path} must be one of ${allowed.join(', ')}`);
  }
  // Membership was just proven against the allowed list; the cast only reifies it.
  return value as T;
}

function normalizeAlternatives(value: unknown, path: string): SerializedClip['alternatives'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new StateValidationFailure(`${path} must be an array`);
  }
  return value.map((entry, index) => {
    const altPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      throw new StateValidationFailure(`${altPath} must be an object`);
    }
    const confidence = entry.confidence;
    if (!isFiniteNumber(confidence) || confidence < 0 || confidence > 1) {
      throw new StateValidationFailure(`${altPath}.confidence must be a number between 0 and 1`);
    }
    return {
      id: nonEmptyString(entry.id, `${altPath}.id`),
      confidence,
      reason: nonEmptyString(entry.reason, `${altPath}.reason`),
    };
  });
}

function normalizeClip(value: unknown, index: number): SerializedClip {
  const path = `clips[${index}]`;
  if (!isRecord(value)) {
    throw new StateValidationFailure(`${path} must be an object`);
  }
  const clip = {
    id: nonEmptyString(value.id, `${path}.id`),
    name: nonEmptyString(value.name, `${path}.name`),
    duration: nonNegativeNumber(value.duration, `${path}.duration`),
    startTime: nonNegativeNumber(value.startTime, `${path}.startTime`),
    trimmedDuration: optionalNonNegativeNumber(value.trimmedDuration, `${path}.trimmedDuration`),
    trimStart: optionalNonNegativeNumber(value.trimStart, `${path}.trimStart`),
    textOverlay: isOptionalString(value.textOverlay) ? value.textOverlay : undefined,
    track: value.track === undefined ? undefined : nonNegativeNumber(value.track, `${path}.track`),
    transitionIn: value.transitionIn === undefined ? undefined : oneOf(value.transitionIn, TRANSITIONS, `${path}.transitionIn`),
    analysis: isOptionalString(value.analysis) ? value.analysis : undefined,
    alternatives: normalizeAlternatives(value.alternatives, `${path}.alternatives`),
  };
  if (clip.track !== undefined && !Number.isInteger(clip.track)) {
    throw new StateValidationFailure(`${path}.track must be a non-negative integer`);
  }
  return clip;
}

function normalizeWord(value: unknown, wordsPath: string, index: number): { word: string; start: number; end: number } {
  const path = `${wordsPath}[${index}]`;
  if (!isRecord(value)) {
    throw new StateValidationFailure(`${path} must be an object`);
  }
  const start = nonNegativeNumber(value.start, `${path}.start`);
  const end = nonNegativeNumber(value.end, `${path}.end`);
  if (start > end) {
    throw new StateValidationFailure(`${path}.start must be <= ${path}.end`);
  }
  return { word: nonEmptyString(value.word, `${path}.word`), start, end };
}

function normalizeSegment(value: unknown, segmentsPath: string, index: number): {
  text: string;
  start: number;
  end: number;
  words?: { word: string; start: number; end: number }[];
} {
  const path = `${segmentsPath}[${index}]`;
  if (!isRecord(value)) {
    throw new StateValidationFailure(`${path} must be an object`);
  }
  const start = nonNegativeNumber(value.start, `${path}.start`);
  const end = nonNegativeNumber(value.end, `${path}.end`);
  if (start > end) {
    throw new StateValidationFailure(`${path}.start must be <= ${path}.end`);
  }
  const segment: { text: string; start: number; end: number; words?: { word: string; start: number; end: number }[] } = {
    text: nonEmptyString(value.text, `${path}.text`),
    start,
    end,
  };
  if (value.words !== undefined) {
    if (!Array.isArray(value.words)) {
      throw new StateValidationFailure(`${path}.words must be an array`);
    }
    segment.words = value.words.map((word, wordIndex) => normalizeWord(word, `${path}.words`, wordIndex));
  }
  return segment;
}

function normalizeVoiceover(value: unknown): SerializedVoiceover | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    throw new StateValidationFailure('voiceover must be an object or null');
  }
  const duration = nonNegativeNumber(value.duration, 'voiceover.duration');
  const trimStart = optionalNonNegativeNumber(value.trimStart, 'voiceover.trimStart');
  const trimEnd = optionalNonNegativeNumber(value.trimEnd, 'voiceover.trimEnd');
  if (trimStart !== undefined && trimEnd !== undefined && trimEnd < trimStart) {
    throw new StateValidationFailure('voiceover.trimEnd must be >= voiceover.trimStart');
  }
  const voiceover: SerializedVoiceover = { duration, trimStart, trimEnd, startTime: optionalNonNegativeNumber(value.startTime, 'voiceover.startTime') };
  if (value.transcription !== undefined) {
    if (typeof value.transcription !== 'string') {
      throw new StateValidationFailure('voiceover.transcription must be a string');
    }
    voiceover.transcription = value.transcription;
  }
  if (value.segments !== undefined) {
    if (!Array.isArray(value.segments)) {
      throw new StateValidationFailure('voiceover.segments must be an array');
    }
    voiceover.segments = value.segments.map((segment, index) => normalizeSegment(segment, 'voiceover.segments', index));
  }
  return voiceover;
}

function normalizeCaptionStyle(value: unknown): CaptionStyle {
  if (!isRecord(value)) {
    throw new StateValidationFailure('captionStyle must be an object');
  }
  if (!isFiniteNumber(value.fontSize) || value.fontSize <= 0) {
    throw new StateValidationFailure('captionStyle.fontSize must be > 0');
  }
  if (typeof value.color !== 'string' || typeof value.bgColor !== 'string') {
    throw new StateValidationFailure('captionStyle.color and captionStyle.bgColor must be strings');
  }
  return {
    mode: oneOf(value.mode, CAPTION_MODES, 'captionStyle.mode'),
    fontSize: value.fontSize,
    color: value.color,
    bgColor: value.bgColor,
    position: oneOf(value.position, CAPTION_POSITIONS, 'captionStyle.position'),
  };
}

/**
 * Validate an untrusted project-state value and return a normalized copy:
 * unknown keys are dropped, an omitted `voiceover` becomes `null`, and
 * everything else is checked field by field.
 */
export function normalizeProjectState(state: unknown): ProjectStatePayload {
  if (!isRecord(state)) {
    throw new StateValidationFailure('state must be an object');
  }
  if (!Array.isArray(state.clips)) {
    throw new StateValidationFailure('clips must be an array');
  }
  if (typeof state.captionsEnabled !== 'boolean') {
    throw new StateValidationFailure('captionsEnabled must be a boolean');
  }
  return {
    clips: state.clips.map((clip, index) => normalizeClip(clip, index)),
    voiceover: normalizeVoiceover(state.voiceover),
    captionStyle: normalizeCaptionStyle(state.captionStyle),
    captionsEnabled: state.captionsEnabled,
  };
}

/** Validate a project name or id: a non-empty, non-whitespace string. */
export function normalizeProjectName(value: unknown, label = 'name'): string {
  if (!isNonEmptyString(value)) {
    throw new StateValidationFailure(`${label} must be a non-empty string`);
  }
  return value;
}
