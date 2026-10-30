import type { CaptionStyle, TransitionType, VideoClip, Voiceover } from '../types';
import { MediaNotFoundError, MediaRequestError, fetchMediaBlob, uploadMediaBlob } from './mediaClient';

/**
 * Media persistence + restore (campaign PR 29).
 *
 * Serialized shapes mirror the server-side ProjectState validation added by
 * campaign PR 24 (projects-api), extended with the media dimension this PR
 * owns: `mediaId` references into /api/media. When the projects API client
 * (campaign PR 26) and save/load modal (campaign PR 27) land, storage swaps
 * to the server-backed API; the serialize/upload/restore logic here survives.
 */

export interface SerializedClipAlternative {
  readonly id: string;
  readonly confidence: number;
  readonly reason: string;
}

export interface SerializedClip {
  readonly id: string;
  readonly name: string;
  /** Original file duration in seconds (never mutated by trims). */
  readonly duration: number;
  /** Start time in the overall timeline; array order is the ordering source of truth. */
  readonly startTime: number;
  readonly trimmedDuration?: number;
  readonly trimStart?: number;
  readonly textOverlay?: string;
  readonly track?: number;
  readonly transitionIn?: TransitionType;
  readonly analysis?: string;
  readonly alternatives?: readonly SerializedClipAlternative[];
  /** /api/media id of this clip's uploaded bytes. */
  readonly mediaId?: string;
  /** Original file name — restored onto the rebuilt File (display name may differ). */
  readonly filename?: string;
}

export interface SerializedVoiceover {
  readonly duration: number;
  readonly trimStart?: number;
  readonly trimEnd?: number;
  readonly transcription?: string;
  readonly segments?: ReadonlyArray<{ text: string; start: number; end: number }>;
  readonly startTime?: number;
  /** /api/media id of the uploaded audio bytes. */
  readonly mediaId?: string;
  /** Original file name (or a mime-derived name for AI-generated audio). */
  readonly filename?: string;
}

export interface SerializedProject {
  readonly clips: readonly SerializedClip[];
  readonly voiceover: SerializedVoiceover | null;
  readonly captionStyle: CaptionStyle;
  readonly captionsEnabled: boolean;
}

export interface SavedProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly savedAt: string;
  readonly project: SerializedProject;
}

export interface SavedProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly savedAt: string;
  readonly clipCount: number;
  readonly hasVoiceover: boolean;
}

/** Server-facing transport for media blobs. Injectable so tests fake the server. */
export interface MediaTransport {
  uploadMedia(blob: Blob, filename: string, mime: string): Promise<{ id: string }>;
  fetchMedia(mediaId: string): Promise<Blob>;
}

export const httpMediaTransport: MediaTransport = {
  uploadMedia: (blob, filename, mime) => uploadMediaBlob(blob, filename, mime),
  fetchMedia: mediaId => fetchMediaBlob(mediaId),
};

/** Where saved project records live. Injectable for tests. */
export interface ProjectStorage {
  saveRecord(record: SavedProjectRecord): void;
  getRecord(id: string): SavedProjectRecord | undefined;
  /** Records newest-first. */
  listRecords(): SavedProjectRecord[];
  deleteRecord(id: string): void;
}

const PROJECTS_INDEX_KEY = 'syncro_saved_projects_v1';

/**
 * localStorage-backed record store. Project JSON is small (metadata only —
 * media bytes live on the server); the server-backed projects API supersedes
 * this backend when campaign PRs 24/26/27 merge.
 */
export function createLocalStorageProjectStorage(storage: Storage = localStorage): ProjectStorage {
  return {
    saveRecord(record): void {
      const records = readIndex(storage).filter(r => r.id !== record.id);
      records.push(record);
      storage.setItem(PROJECTS_INDEX_KEY, JSON.stringify(records));
    },
    getRecord(id): SavedProjectRecord | undefined {
      return readIndex(storage).find(r => r.id === id);
    },
    listRecords(): SavedProjectRecord[] {
      return readIndex(storage).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
    deleteRecord(id): void {
      storage.setItem(PROJECTS_INDEX_KEY, JSON.stringify(readIndex(storage).filter(r => r.id !== id)));
    },
  };
}

function readIndex(storage: Storage): SavedProjectRecord[] {
  const raw = storage.getItem(PROJECTS_INDEX_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedProjectRecord[]) : [];
  } catch {
    // Corrupt index — treat as empty rather than bricking the open dialog.
    return [];
  }
}

/** The editor state a saved project captures, per the code map §5 serialization list. */
export interface ProjectSnapshotInput {
  readonly clips: ReadonlyArray<VideoClip>;
  readonly voiceover: Readonly<Voiceover> | null;
  readonly captionStyle: CaptionStyle;
  readonly captionsEnabled: boolean;
}

/** JSON-safe projection of the editor state: browser-only handles (file/url) never enter the shape. */
export function serializeProject(input: ProjectSnapshotInput): SerializedProject {
  return {
    clips: input.clips.map(serializeClip),
    voiceover: input.voiceover ? serializeVoiceover(input.voiceover) : null,
    captionStyle: input.captionStyle,
    captionsEnabled: input.captionsEnabled,
  };
}

function serializeClip(clip: Readonly<VideoClip>): SerializedClip {
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
    alternatives: clip.alternatives?.map(alt => ({ id: alt.id, confidence: alt.confidence, reason: alt.reason })),
    mediaId: clip.mediaId,
    filename: clip.file.name,
  };
}

function serializeVoiceover(voiceover: Readonly<Voiceover>): SerializedVoiceover {
  return {
    duration: voiceover.duration,
    trimStart: voiceover.trimStart,
    trimEnd: voiceover.trimEnd,
    transcription: voiceover.transcription,
    segments: voiceover.segments?.map(seg => ({ text: seg.text, start: seg.start, end: seg.end })),
    startTime: voiceover.startTime,
    mediaId: voiceover.mediaId,
    filename: voiceover.file?.name,
  };
}

/** A clip restored with its metadata but whose saved blob could not be fetched. */
export interface ClipRestoreError {
  readonly clipId: string;
  readonly name: string;
  readonly reason: string;
}

export interface RestoreResult {
  readonly projectId: string;
  readonly name: string;
  readonly savedAt: string;
  readonly clips: VideoClip[];
  readonly voiceover: Voiceover | null;
  /** Per-clip error state for blobs that could not be restored (metadata still lands in the timeline). */
  readonly clipErrors: ClipRestoreError[];
  readonly voiceoverError: string | null;
  readonly captionStyle: CaptionStyle;
  readonly captionsEnabled: boolean;
}

/** Thrown when the requested project record no longer exists. */
export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = 'ProjectNotFoundError';
  }
}

export interface SaveProjectInput extends ProjectSnapshotInput {
  readonly name: string;
  /** Set to overwrite an existing record (re-saving the currently-open project). */
  readonly projectId?: string;
  readonly transport?: MediaTransport;
  readonly storage?: ProjectStorage;
}

export interface SavedProjectResult {
  readonly record: SavedProjectRecord;
  readonly summary: SavedProjectSummary;
}

/**
 * Persist the editor state: upload every clip's media (and the voiceover's)
 * that has not been persisted yet, then store the serialized snapshot with
 * the resulting ids.
 *
 * Upload policy: clips/voiceovers already carrying a `mediaId` are skipped —
 * their bytes never mutate after creation, so re-saving cannot duplicate
 * blobs. A clip restored with a missing blob keeps its (dangling) id, so the
 * error state survives re-saves instead of being silently rewritten.
 */
export async function saveProject(input: SaveProjectInput): Promise<SavedProjectResult> {
  const transport = input.transport ?? httpMediaTransport;
  const storage = input.storage ?? createLocalStorageProjectStorage();

  const serializedClips: SerializedClip[] = [];
  for (const clip of input.clips) {
    serializedClips.push({ ...serializeClip(clip), mediaId: clip.mediaId ?? (await uploadClipMedia(clip, transport)) });
  }

  const serializedVoiceover = input.voiceover
    ? await serializePersistedVoiceover(input.voiceover, transport)
    : null;

  const record: SavedProjectRecord = {
    id: input.projectId ?? newProjectId(),
    name: input.name,
    savedAt: new Date().toISOString(),
    project: {
      clips: serializedClips,
      voiceover: serializedVoiceover,
      captionStyle: input.captionStyle,
      captionsEnabled: input.captionsEnabled,
    },
  };
  storage.saveRecord(record);

  return {
    record,
    summary: {
      id: record.id,
      name: record.name,
      savedAt: record.savedAt,
      clipCount: record.project.clips.length,
      hasVoiceover: record.project.voiceover !== null,
    },
  };
}

async function uploadClipMedia(clip: Readonly<VideoClip>, transport: MediaTransport): Promise<string> {
  const { id } = await transport.uploadMedia(clip.file, clip.name, clip.file.type || 'video/mp4');
  return id;
}

async function serializePersistedVoiceover(voiceover: Readonly<Voiceover>, transport: MediaTransport): Promise<SerializedVoiceover> {
  const base = serializeVoiceover(voiceover);
  if (voiceover.mediaId) return base;

  // AI-generated audio has no File — read its current bytes back through the
  // blob: URL so TTS output persists too.
  const blob = voiceover.file ?? (await blobFromObjectUrl(voiceover.url));
  const mime = blob.type || 'audio/webm';
  const filename = voiceover.file?.name ?? audioNameForMime(mime);
  const { id } = await transport.uploadMedia(blob, filename, mime);
  return { ...base, mediaId: id, filename };
}

export function newProjectId(): string {
  return crypto.randomUUID();
}

export interface RestoreOptions {
  readonly transport?: MediaTransport;
  readonly storage?: ProjectStorage;
  /** Mint object URLs; injectable for tests (jsdom has no createObjectURL). */
  readonly createObjectUrl?: (blob: Blob) => string;
}

/**
 * Rehydrate a saved project: fetch every referenced blob, rebuild File
 * objects, mint fresh object URLs. Never throws for missing media — a blob
 * that cannot be fetched becomes a per-clip error state (metadata restored,
 * `mediaMissing` set) or a dropped voiceover with `voiceoverError`.
 */
export async function restoreProject(projectId: string, options: RestoreOptions = {}): Promise<RestoreResult> {
  const transport = options.transport ?? httpMediaTransport;
  const storage = options.storage ?? createLocalStorageProjectStorage();
  const createObjectUrl = options.createObjectUrl ?? (blob => URL.createObjectURL(blob));

  const record = storage.getRecord(projectId);
  if (!record) throw new ProjectNotFoundError(projectId);

  const clipErrors: ClipRestoreError[] = [];
  const clips = await Promise.all(
    record.project.clips.map(async serialized => restoreClip(serialized, transport, createObjectUrl, clipErrors)),
  );

  let voiceover: Voiceover | null = null;
  let voiceoverError: string | null = null;
  const serializedVoiceover = record.project.voiceover;
  if (serializedVoiceover?.mediaId) {
    try {
      voiceover = await restoreVoiceover(serializedVoiceover, serializedVoiceover.mediaId, transport, createObjectUrl);
    } catch (err) {
      voiceoverError = mediaErrorReason(err);
    }
  } else if (serializedVoiceover) {
    voiceoverError = 'Saved voiceover has no stored audio (saved by an older version).';
  }

  return {
    projectId: record.id,
    name: record.name,
    savedAt: record.savedAt,
    clips,
    voiceover,
    clipErrors,
    voiceoverError,
    captionStyle: record.project.captionStyle,
    captionsEnabled: record.project.captionsEnabled,
  };
}

async function restoreClip(
  serialized: SerializedClip,
  transport: MediaTransport,
  createObjectUrl: (blob: Blob) => string,
  clipErrors: ClipRestoreError[],
): Promise<VideoClip> {
  const metadata: Omit<VideoClip, 'file' | 'url'> = {
    id: serialized.id,
    duration: serialized.duration,
    startTime: serialized.startTime,
    trimmedDuration: serialized.trimmedDuration,
    trimStart: serialized.trimStart,
    name: serialized.name,
    analysis: serialized.analysis,
    textOverlay: serialized.textOverlay,
    track: serialized.track,
    transitionIn: serialized.transitionIn,
    alternatives: serialized.alternatives?.map(alt => ({ ...alt })),
    mediaId: serialized.mediaId,
  };

  if (!serialized.mediaId) {
    clipErrors.push({ clipId: serialized.id, name: serialized.name, reason: 'Saved clip has no stored media.' });
    return { ...metadata, file: emptyFile(serialized.filename ?? serialized.name), url: '', mediaMissing: true };
  }

  try {
    const blob = await transport.fetchMedia(serialized.mediaId);
    const file = new File([blob], serialized.filename ?? serialized.name, { type: blob.type || 'video/mp4' });
    return { ...metadata, file, url: createObjectUrl(file) };
  } catch (err) {
    clipErrors.push({ clipId: serialized.id, name: serialized.name, reason: mediaErrorReason(err) });
    return { ...metadata, file: emptyFile(serialized.filename ?? serialized.name), url: '', mediaMissing: true };
  }
}

async function restoreVoiceover(
  serialized: SerializedVoiceover,
  mediaId: string,
  transport: MediaTransport,
  createObjectUrl: (blob: Blob) => string,
): Promise<Voiceover> {
  const blob = await transport.fetchMedia(mediaId);
  const file = new File([blob], serialized.filename ?? 'voiceover', { type: blob.type || 'audio/webm' });
  return {
    file,
    url: createObjectUrl(file),
    duration: serialized.duration,
    trimStart: serialized.trimStart,
    trimEnd: serialized.trimEnd,
    transcription: serialized.transcription,
    segments: serialized.segments?.map(seg => ({ ...seg })),
    startTime: serialized.startTime,
    mediaId,
  };
}

/** Missing media keeps a typed placeholder: the timeline renders the error state, nothing crashes. */
function emptyFile(name: string): File {
  return new File([], name, { type: 'video/mp4' });
}

function mediaErrorReason(err: unknown): string {
  if (err instanceof MediaNotFoundError) return 'Saved media no longer exists on the server.';
  if (err instanceof Error) return err.message;
  return 'Unknown media error';
}

/** Read bytes back out of a blob: URL (used to persist AI-generated audio). */
export async function blobFromObjectUrl(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new MediaRequestError(`Could not read media from ${url}`, res.status);
  return res.blob();
}

function audioNameForMime(mime: string): string {
  const ext = mime.includes('wav') ? 'wav' : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3' : mime.includes('ogg') ? 'ogg' : 'webm';
  return `voiceover.${ext}`;
}

export function deleteProject(projectId: string, storage: ProjectStorage = createLocalStorageProjectStorage()): void {
  storage.deleteRecord(projectId);
}

// Convenience for callers listing saved projects (the open dialog data source).
export function listSavedProjects(storage: ProjectStorage = createLocalStorageProjectStorage()): SavedProjectSummary[] {
  return storage.listRecords().map(record => ({
    id: record.id,
    name: record.name,
    savedAt: record.savedAt,
    clipCount: record.project.clips.length,
    hasVoiceover: record.project.voiceover !== null,
  }));
}
