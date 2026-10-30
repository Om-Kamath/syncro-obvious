import { unzip, zip, strFromU8, strToU8, type AsyncZippable } from 'fflate';
import { CaptionStyle, TransitionType, VideoClip, Voiceover } from '../types';

// Zip layout: project.json (compressed) + media/<file> entries stored
// uncompressed — video/audio/JPEG bytes are already compressed, so deflating
// them only burns CPU. The manifest is small but benefits from compression.

const MANIFEST_PATH = 'project.json';
const MANIFEST_FORMAT = 'syncro-project';
export const MANIFEST_VERSION = 1;
const MEDIA_DIR = 'media';
const DEFAULT_PROJECT_NAME = 'Syncro project';

export class ProjectZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectZipError';
  }
}

export interface SerializedClip {
  id: string;
  name: string;
  duration: number;
  startTime: number;
  trimmedDuration?: number;
  trimStart?: number;
  textOverlay?: string;
  track?: number;
  transitionIn?: TransitionType;
  analysis?: string;
  alternatives?: VideoClip['alternatives'];
  mediaPath: string;
  mediaType: string;
}

export interface SerializedVoiceover {
  duration: number;
  trimStart?: number;
  trimEnd?: number;
  startTime?: number;
  transcription?: string;
  segments?: Voiceover['segments'];
  // null when the audio bytes could not be recovered at export time
  // (AI-generated TTS audio whose blob URL was unfetchable): the voiceover
  // metadata still round-trips, but the audio itself must be re-added.
  mediaPath: string | null;
  mediaType: string;
  fileName: string;
}

export interface ProjectManifest {
  format: typeof MANIFEST_FORMAT;
  version: number;
  name: string;
  exportedAt: string;
  clips: SerializedClip[];
  voiceover: SerializedVoiceover | null;
  captionsEnabled: boolean;
  captionStyle: CaptionStyle;
}

export interface ExportableProject {
  clips: VideoClip[];
  voiceover: Voiceover | null;
  captionsEnabled: boolean;
  captionStyle: CaptionStyle;
  name?: string;
}

export interface ImportedProject {
  name: string;
  clips: VideoClip[];
  voiceover: Voiceover | null;
  captionsEnabled: boolean;
  captionStyle: CaptionStyle;
}

export async function exportProjectZip(project: ExportableProject): Promise<Blob> {
  const mediaFiles: Record<string, Uint8Array> = {};
  const clips: SerializedClip[] = [];

  for (const [index, clip] of project.clips.entries()) {
    const mediaPath = `${MEDIA_DIR}/clip-${index}-${sanitizeMediaName(clip.name, 'clip')}`;
    mediaFiles[mediaPath] = new Uint8Array(await clip.file.arrayBuffer());
    clips.push(serializeClip(clip, mediaPath));
  }

  let voiceover: SerializedVoiceover | null = null;
  if (project.voiceover) {
    const media = await readVoiceoverBytes(project.voiceover);
    voiceover = serializeVoiceover(project.voiceover, media);
    if (media && voiceover.mediaPath) {
      mediaFiles[voiceover.mediaPath] = new Uint8Array(media.bytes);
    }
  }

  const manifest: ProjectManifest = {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    name: project.name?.trim() || DEFAULT_PROJECT_NAME,
    exportedAt: new Date().toISOString(),
    clips,
    voiceover,
    captionsEnabled: project.captionsEnabled,
    captionStyle: project.captionStyle,
  };

  const files: AsyncZippable = {
    [MANIFEST_PATH]: [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }],
    ...mediaFiles,
  };

  const zipped = await zipAsync(files);
  return new Blob([zipped], { type: 'application/zip' });
}

export async function importProjectZip(source: Blob): Promise<ImportedProject> {
  const bytes = new Uint8Array(await source.arrayBuffer());
  const entries = await unzipAsync(bytes);

  const manifestBytes = entries[MANIFEST_PATH];
  if (!manifestBytes) {
    throw new ProjectZipError('This file is not a Syncro project archive (project.json is missing).');
  }
  const manifest = parseManifest(safeJsonParse(strFromU8(manifestBytes)));

  const createdUrls: string[] = [];
  const revokeOnError = (error: unknown): never => {
    createdUrls.forEach(url => URL.revokeObjectURL(url));
    throw error;
  };

  try {
    const clips: VideoClip[] = [];
    for (const meta of manifest.clips) {
      const entry = entries[meta.mediaPath];
      if (!entry) {
        throw new ProjectZipError(`Project archive is incomplete: media for clip "${meta.name}" (${meta.mediaPath}) is missing.`);
      }
      const file = new File([entry], meta.name, { type: meta.mediaType });
      const url = URL.createObjectURL(file);
      createdUrls.push(url);
      clips.push(restoreClip(meta, file, url));
    }

    let voiceover: Voiceover | null = null;
    if (manifest.voiceover) {
      const meta = manifest.voiceover;
      if (meta.mediaPath) {
        const entry = entries[meta.mediaPath];
        if (!entry) {
          throw new ProjectZipError(`Project archive is incomplete: voiceover audio (${meta.mediaPath}) is missing.`);
        }
        const file = new File([entry], meta.fileName, { type: meta.mediaType });
        const url = URL.createObjectURL(file);
        createdUrls.push(url);
        voiceover = restoreVoiceover(meta, file, url);
      } else {
        // No audio bytes in the archive (unrecoverable at export time) —
        // restore the metadata with an empty URL rather than dropping it.
        voiceover = restoreVoiceover(meta, undefined, '');
      }
    }

    return {
      name: manifest.name,
      clips,
      voiceover,
      captionsEnabled: manifest.captionsEnabled,
      captionStyle: manifest.captionStyle,
    };
  } catch (error) {
    revokeOnError(error);
  }
}

function serializeClip(clip: VideoClip, mediaPath: string): SerializedClip {
  return {
    id: clip.id,
    name: clip.name,
    duration: clip.duration,
    startTime: clip.startTime,
    trimmedDuration: clip.trimmedDuration,
    trimStart: clip.trimStart,
    textOverlay: clip.textOverlay,
    track: clip.track,
    transitionIn: clip.transitionIn,
    analysis: clip.analysis,
    alternatives: clip.alternatives,
    mediaPath,
    mediaType: clip.file.type || 'application/octet-stream',
  };
}

function serializeVoiceover(voiceover: Voiceover, media: VoiceoverMedia | null): SerializedVoiceover {
  return {
    duration: voiceover.duration,
    trimStart: voiceover.trimStart,
    trimEnd: voiceover.trimEnd,
    startTime: voiceover.startTime,
    transcription: voiceover.transcription,
    segments: voiceover.segments,
    mediaPath: media === null
      ? null
      : `${MEDIA_DIR}/voiceover-${sanitizeMediaName(voiceover.file?.name ?? 'generated', 'voiceover')}`,
    mediaType: media === null ? 'application/octet-stream' : media.mediaType,
    fileName: voiceover.file?.name ?? 'generated-audio',
  };
}

interface VoiceoverMedia {
  bytes: ArrayBuffer;
  mediaType: string;
}

// AI-generated voiceovers have no File — the blob: URL is the only handle on
// their bytes. Blob URLs are fetchable while the page lives; if that fails we
// degrade to metadata-only (mediaPath: null) instead of failing the export.
async function readVoiceoverBytes(voiceover: Voiceover): Promise<VoiceoverMedia | null> {
  if (voiceover.file) {
    return { bytes: await voiceover.file.arrayBuffer(), mediaType: voiceover.file.type || 'application/octet-stream' };
  }
  try {
    const response = await fetch(voiceover.url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return { bytes: await blob.arrayBuffer(), mediaType: blob.type || 'application/octet-stream' };
  } catch {
    return null;
  }
}

function restoreClip(meta: SerializedClip, file: File, url: string): VideoClip {
  return {
    id: meta.id,
    file,
    url,
    duration: meta.duration,
    trimmedDuration: meta.trimmedDuration,
    trimStart: meta.trimStart,
    startTime: meta.startTime,
    name: meta.name,
    analysis: meta.analysis,
    textOverlay: meta.textOverlay,
    track: meta.track,
    transitionIn: meta.transitionIn,
    alternatives: meta.alternatives,
  };
}

function restoreVoiceover(meta: SerializedVoiceover, file: File | undefined, url: string): Voiceover {
  return {
    file,
    url,
    duration: meta.duration,
    trimStart: meta.trimStart,
    trimEnd: meta.trimEnd,
    transcription: meta.transcription,
    segments: meta.segments,
    startTime: meta.startTime,
  };
}

function sanitizeMediaName(name: string, fallback: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  if (cleaned.length === 0) return fallback;
  return cleaned.slice(0, 100);
}

async function zipAsync(files: AsyncZippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 0 }, (error, data) => (error ? reject(error) : resolve(data)));
  });
}

async function unzipAsync(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (error, files) => {
      if (error) reject(new ProjectZipError('This file is not a valid zip archive.'));
      else resolve(files);
    });
  });
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ProjectZipError('The project manifest (project.json) is corrupted.');
  }
}

function parseManifest(value: unknown): ProjectManifest {
  const rec = readRecord(value, 'The project manifest');
  if (rec.format !== MANIFEST_FORMAT) {
    throw new ProjectZipError('This zip is not a Syncro project archive.');
  }
  const version = readNumber(rec, 'version', 'The project manifest');
  if (version > MANIFEST_VERSION) {
    throw new ProjectZipError(`This project was exported by a newer version of Syncro (format v${version}).`);
  }
  if (version !== MANIFEST_VERSION) {
    throw new ProjectZipError('The project manifest version is invalid.');
  }

  const clipsRec = rec.clips;
  if (!Array.isArray(clipsRec)) {
    throw new ProjectZipError('The project manifest is missing its clips.');
  }
  const clips = clipsRec.map((clip, index) => parseSerializedClip(clip, index));

  const voiceoverRec = rec.voiceover;
  const voiceover = voiceoverRec === null || voiceoverRec === undefined ? null : parseSerializedVoiceover(voiceoverRec);

  return {
    format: MANIFEST_FORMAT,
    version,
    name: typeof rec.name === 'string' && rec.name.length > 0 ? rec.name : DEFAULT_PROJECT_NAME,
    exportedAt: typeof rec.exportedAt === 'string' ? rec.exportedAt : '',
    clips,
    voiceover,
    captionsEnabled: readBoolean(rec, 'captionsEnabled', 'The project manifest'),
    captionStyle: parseCaptionStyle(rec.captionStyle),
  };
}

function parseSerializedClip(value: unknown, index: number): SerializedClip {
  const rec = readRecord(value, `Clip ${index + 1}`);
  const what = `Clip ${index + 1}`;
  const transitionIn = optionalString(rec, 'transitionIn');
  return {
    id: readString(rec, 'id', what),
    name: readString(rec, 'name', what),
    duration: readNumber(rec, 'duration', what),
    startTime: readNumber(rec, 'startTime', what),
    trimmedDuration: optionalNumber(rec, 'trimmedDuration'),
    trimStart: optionalNumber(rec, 'trimStart'),
    textOverlay: optionalString(rec, 'textOverlay'),
    track: optionalNumber(rec, 'track'),
    transitionIn: transitionIn === undefined ? undefined : parseTransitionType(transitionIn, what),
    analysis: optionalString(rec, 'analysis'),
    alternatives: parseAlternatives(rec.alternatives),
    mediaPath: readString(rec, 'mediaPath', what),
    mediaType: typeof rec.mediaType === 'string' && rec.mediaType.length > 0 ? rec.mediaType : 'application/octet-stream',
  };
}

function parseSerializedVoiceover(value: unknown): SerializedVoiceover {
  const rec = readRecord(value, 'The voiceover');
  const what = 'The voiceover';
  const mediaPath = rec.mediaPath === null ? null : readString(rec, 'mediaPath', what);
  return {
    duration: readNumber(rec, 'duration', what),
    trimStart: optionalNumber(rec, 'trimStart'),
    trimEnd: optionalNumber(rec, 'trimEnd'),
    startTime: optionalNumber(rec, 'startTime'),
    transcription: optionalString(rec, 'transcription'),
    segments: parseSegments(rec.segments),
    mediaPath,
    mediaType: typeof rec.mediaType === 'string' && rec.mediaType.length > 0 ? rec.mediaType : 'application/octet-stream',
    fileName: typeof rec.fileName === 'string' && rec.fileName.length > 0 ? rec.fileName : 'voiceover',
  };
}

function parseCaptionStyle(value: unknown): CaptionStyle {
  const rec = readRecord(value, 'The caption style');
  const modes = ['lower-third', 'word-highlight', 'speaker-labeled'] as const;
  const mode = readString(rec, 'mode', 'The caption style');
  if (!modes.includes(mode as CaptionStyle['mode'])) {
    throw new ProjectZipError('The caption style is malformed (unknown mode).');
  }
  const position = readString(rec, 'position', 'The caption style');
  if (position !== 'bottom' && position !== 'top') {
    throw new ProjectZipError('The caption style is malformed (unknown position).');
  }
  return {
    mode: mode as CaptionStyle['mode'],
    fontSize: readNumber(rec, 'fontSize', 'The caption style'),
    color: readString(rec, 'color', 'The caption style'),
    bgColor: readString(rec, 'bgColor', 'The caption style'),
    position,
  };
}

const TRANSITIONS: TransitionType[] = ['cut', 'fade', 'dissolve', 'wipe'];

function parseTransitionType(value: string, what: string): TransitionType {
  if (!TRANSITIONS.includes(value as TransitionType)) {
    throw new ProjectZipError(`${what} is malformed (unknown transition "${value}").`);
  }
  return value as TransitionType;
}

function parseAlternatives(value: unknown): SerializedClip['alternatives'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ProjectZipError('A clip alternative list is malformed.');
  return value.map(alt => {
    const rec = readRecord(alt, 'A clip alternative');
    return {
      id: readString(rec, 'id', 'A clip alternative'),
      confidence: readNumber(rec, 'confidence', 'A clip alternative'),
      reason: readString(rec, 'reason', 'A clip alternative'),
    };
  });
}

function parseSegments(value: unknown): Voiceover['segments'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ProjectZipError('The voiceover segments are malformed.');
  return value.map(seg => {
    const rec = readRecord(seg, 'A caption segment');
    return {
      text: readString(rec, 'text', 'A caption segment'),
      start: readNumber(rec, 'start', 'A caption segment'),
      end: readNumber(rec, 'end', 'A caption segment'),
    };
  });
}

function readRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProjectZipError(`${what} is malformed.`);
  }
  return value as Record<string, unknown>;
}

function readString(rec: Record<string, unknown>, key: string, what: string): string {
  const value = rec[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProjectZipError(`${what} is malformed (missing "${key}").`);
  }
  return value;
}

function optionalString(rec: Record<string, unknown>, key: string): string | undefined {
  const value = rec[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(rec: Record<string, unknown>, key: string, what: string): number {
  const value = rec[key];
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ProjectZipError(`${what} is malformed (missing or invalid "${key}").`);
  }
  return value;
}

function optionalNumber(rec: Record<string, unknown>, key: string): number | undefined {
  const value = rec[key];
  return typeof value === 'number' && !Number.isNaN(value) ? value : undefined;
}

function readBoolean(rec: Record<string, unknown>, key: string, what: string): boolean {
  const value = rec[key];
  if (typeof value !== 'boolean') {
    throw new ProjectZipError(`${what} is malformed (missing "${key}").`);
  }
  return value;
}
