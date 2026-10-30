import type {
  ProjectStatePayload,
  SerializedClip,
  SerializedVoiceover,
} from '../../src/services/projectApi';

/**
 * Typed HTTP client for the Syncro server API, consumed by the MCP tools.
 *
 * - Projects CRUD mirrors the wire contract documented in
 *   `src/services/projectApi.ts`: GET/PUT `/api/projects/:id` with
 *   `{ name, state }` payloads.
 * - Media is the shipped route (`server/media/media.router.ts`): `POST
 *   /api/media` takes the raw body, filename via `?filename=` (or the
 *   `x-filename` header), MIME via the `Content-Type` header, and answers
 *   `201` with a `Location` header and a `MediaMetadata` JSON body.
 */

/** Re-exported so tool modules share one type source with the browser client. */
export type { ProjectStatePayload, SerializedClip, SerializedVoiceover };

export interface ProjectRecord {
  id: string;
  name: string;
  state: ProjectStatePayload;
  createdAt?: string;
  updatedAt?: string;
}

/** Result of a successful `POST /api/media` upload (server `MediaMetadata` + resolved URL). */
export interface MediaAsset {
  id: string;
  /** `Location` header, or the conventional `/api/media/:id` when the server omits it. */
  url: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  createdAt?: string;
}

/** Error thrown for non-2xx or non-JSON Syncro API responses. */
export class SyncroApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SyncroApiError';
    this.status = status;
  }
}

export type FetchLike = typeof fetch;

export interface SyncroApiClientOptions {
  /** API base URL, e.g. `http://localhost:3001` (trailing slashes are trimmed). */
  baseUrl: string;
  /** Fetch implementation override for tests; defaults to the global `fetch`. */
  fetch?: FetchLike;
}

export interface UploadMediaInput {
  bytes: Uint8Array;
  filename?: string;
  contentType?: string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SyncroApiError(
      response.status,
      `Syncro server returned non-JSON response: ${text.slice(0, 200)}`,
    );
  }
}

/** Parse the body and throw `SyncroApiError` for non-2xx responses. */
async function assertOk(response: Response): Promise<unknown> {
  const body = await readJsonBody(response);
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string'
      ? body.error
      : `Syncro API request failed with status ${response.status}`;
    throw new SyncroApiError(response.status, message);
  }
  return body;
}

function requireId(body: unknown, context: string): string {
  if (isRecord(body) && typeof body.id === 'string' && body.id.length > 0) {
    return body.id;
  }
  throw new SyncroApiError(500, `Syncro server response is missing an id (${context})`);
}

/** Minimal shape check; state contents were validated by the server on write. */
function toProjectRecord(body: unknown): ProjectRecord {
  if (isRecord(body) && typeof body.id === 'string' && typeof body.name === 'string' && isRecord(body.state)) {
    return {
      id: body.id,
      name: body.name,
      state: body.state as unknown as ProjectStatePayload,
      createdAt: typeof body.createdAt === 'string' ? body.createdAt : undefined,
      updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : undefined,
    };
  }
  throw new SyncroApiError(500, 'Syncro server returned a malformed project record');
}

/** Look up a mime type by filename extension; unknown or missing names fall back to octet-stream. */
export function guessMimeFromFilename(filename: string | undefined): string {
  const extension = filename?.split('.').pop()?.toLowerCase() ?? '';
  const table: Record<string, string> = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  return table[extension] ?? 'application/octet-stream';
}

export class SyncroApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: SyncroApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
  }

  async uploadMedia(input: UploadMediaInput): Promise<MediaAsset> {
    // Media association with a project is attach_media's job (it writes the
    // project state) — the shipped media route stores no project linkage.
    const query = input.filename !== undefined ? `?filename=${encodeURIComponent(input.filename)}` : '';

    const response = await this.fetchImpl(`${this.baseUrl}/api/media${query}`, {
      method: 'POST',
      headers: { 'Content-Type': input.contentType ?? 'application/octet-stream' },
      body: input.bytes as Uint8Array<ArrayBuffer>,
    });
    const body = await assertOk(response);
    const id = requireId(body, 'media upload');
    const location = response.headers.get('location') ?? `/api/media/${id}`;
    const asset: MediaAsset = { id, url: location };
    if (isRecord(body)) {
      if (typeof body.filename === 'string') asset.filename = body.filename;
      if (typeof body.mimeType === 'string') asset.mimeType = body.mimeType;
      if (typeof body.size === 'number') asset.size = body.size;
      if (typeof body.createdAt === 'string') asset.createdAt = body.createdAt;
    }
    return asset;
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/projects`);
    const body = await assertOk(response);
    if (!Array.isArray(body)) {
      throw new SyncroApiError(500, 'Syncro server returned a malformed project list');
    }
    return body.map(toProjectRecord);
  }

  async getProject(id: string): Promise<ProjectRecord> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/projects/${encodeURIComponent(id)}`);
    const body = await assertOk(response);
    return toProjectRecord(body);
  }

  async updateProject(id: string, payload: { name: string; state: ProjectStatePayload }): Promise<ProjectRecord> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/projects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await assertOk(response);
    return toProjectRecord(body);
  }

  async createProject(payload: { name: string; state: ProjectStatePayload }): Promise<ProjectRecord> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await assertOk(response);
    return toProjectRecord(body);
  }

  async deleteProject(id: string): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    // 204 has no body; assertOk still maps non-2xx to SyncroApiError.
    await assertOk(response);
  }
}
