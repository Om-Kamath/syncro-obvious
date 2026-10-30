import type { CaptionStyle, VideoClip, Voiceover } from '../types';
import { normalizeErrorMessage } from './geminiClient';

/**
 * Typed client for the Syncro projects/media API.
 *
 * Wire contract the server is expected to satisfy (campaign spec W5 —
 * server scaffold, projects API, media API):
 *
 *   GET    /api/projects      → 200 ProjectSummary[]
 *   POST   /api/projects      { name, state }               → 200 ProjectRecord
 *   GET    /api/projects/:id  → 200 ProjectRecord
 *   PUT    /api/projects/:id  { name?, state? }             → 200 ProjectRecord
 *   DELETE /api/projects/:id  → 204 (no body)
 *   POST   /api/media         multipart/form-data: file     → 200 { id, url }
 *   GET    /api/media/:id     → media bytes (range requests)
 *
 * Timestamps are ISO strings on the wire. Every failure is normalized to
 * `ApiError` so callers handle one error shape; caller-initiated aborts pass
 * through untouched.
 */

export type SerializedClip = Omit<VideoClip, 'file' | 'url'>;
export type SerializedVoiceover = Omit<Voiceover, 'file' | 'url'>;

export interface ProjectStatePayload {
  clips: SerializedClip[];
  voiceover: SerializedVoiceover | null;
  captionStyle: CaptionStyle;
  captionsEnabled: boolean;
}

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  state: ProjectStatePayload;
}

export type ProjectSummary = Pick<ProjectRecord, 'id' | 'name' | 'createdAt' | 'updatedAt'>;

export interface ProjectPatch {
  name?: string;
  state?: ProjectStatePayload;
}

export interface MediaUploadResult {
  id: string;
  url: string;
}

export const DEFAULT_API_BASE = '/api';

export interface RequestOptions {
  /** API base URL; defaults to `DEFAULT_API_BASE` (same-origin `/api`). */
  baseUrl?: string;
  /** Propagated to fetch for caller-initiated cancellation. */
  signal?: AbortSignal;
}

/**
 * Normalized API failure. `status` is the HTTP status, or 0 when the request
 * never got a response (network failure). `code` is machine-readable: either
 * the server-provided code or a client-side constant (`network_error`,
 * `http_error`, `invalid_response`).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly url: string;

  constructor(
    message: string,
    options: { status: number; code: string; url: string; cause?: unknown }
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code;
    this.url = options.url;
  }
}

function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface ErrorDetail {
  message?: string;
  code?: string;
}

const MAX_ERROR_DETAIL_LENGTH = 200;

/**
 * Best-effort extraction of a human-readable message and machine code from an
 * error response body: JSON `{ message }` / `{ error }` / `{ code }`, or a
 * short plain-text body. HTML bodies (dev-server 404 pages) yield nothing —
 * the caller falls back to the HTTP status line. Never throws.
 */
async function extractErrorDetail(response: Response): Promise<ErrorDetail | undefined> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) return undefined;
      return {
        message:
          typeof parsed.message === 'string'
            ? parsed.message
            : typeof parsed.error === 'string'
              ? parsed.error
              : undefined,
        code: typeof parsed.code === 'string' ? parsed.code : undefined,
      };
    } catch {
      const trimmed = text.trim().slice(0, MAX_ERROR_DETAIL_LENGTH);
      if (trimmed.startsWith('<')) return undefined;
      return { message: trimmed };
    }
  } catch {
    return undefined;
  }
}

async function httpError(response: Response, url: string): Promise<ApiError> {
  const detail = await extractErrorDetail(response);
  const fallback = `Request failed with status ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  return new ApiError(detail?.message ?? fallback, {
    status: response.status,
    code: detail?.code ?? 'http_error',
    url,
  });
}

async function parseJsonBody(response: Response, url: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (err) {
    throw new ApiError(`Server returned malformed JSON (status ${response.status})`, {
      status: response.status,
      code: 'invalid_response',
      url,
      cause: err,
    });
  }
}

interface RequestConfig extends RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: BodyInit;
  headers?: Record<string, string>;
  /** Skip body parsing (endpoints with no response body). */
  ignoreBody?: boolean;
}

interface ParsedResponse {
  status: number;
  url: string;
  data: unknown;
}

async function request(path: string, config: RequestConfig): Promise<ParsedResponse> {
  const url = buildUrl(config.baseUrl ?? DEFAULT_API_BASE, path);
  let response: Response;
  try {
    response = await fetch(url, {
      method: config.method,
      body: config.body,
      headers: config.headers,
      signal: config.signal,
    });
  } catch (err) {
    // Caller-initiated cancellation keeps its native shape so callers can
    // distinguish "user cancelled" from "request failed".
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ApiError(`Network request failed: ${normalizeErrorMessage(err)}`, {
      status: 0,
      code: 'network_error',
      url,
      cause: err,
    });
  }

  if (!response.ok) throw await httpError(response, url);
  if (config.ignoreBody || response.status === 204) {
    return { status: response.status, url, data: undefined };
  }
  const data = await parseJsonBody(response, url);
  return { status: response.status, url, data };
}

function isProjectSummary(value: unknown): value is ProjectSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function isProjectRecord(value: unknown): value is ProjectRecord {
  // The envelope is checked here; deep state validation is the server's job
  // (campaign PR 24) and stays out of the client's hot path.
  return isRecord(value) && isRecord(value.state) && isProjectSummary(value);
}

function assertSummaryList(
  data: unknown,
  status: number,
  url: string
): asserts data is ProjectSummary[] {
  if (Array.isArray(data) && data.every(isProjectSummary)) return;
  throw new ApiError('Unexpected projects list payload from server', {
    status,
    code: 'invalid_response',
    url,
  });
}

function assertProjectRecord(
  data: unknown,
  status: number,
  url: string
): asserts data is ProjectRecord {
  if (isProjectRecord(data)) return;
  throw new ApiError('Unexpected project payload from server', {
    status,
    code: 'invalid_response',
    url,
  });
}

export async function listProjects(options: RequestOptions = {}): Promise<ProjectSummary[]> {
  const { status, url, data } = await request('/projects', { method: 'GET', ...options });
  assertSummaryList(data, status, url);
  return data;
}

export async function getProject(id: string, options: RequestOptions = {}): Promise<ProjectRecord> {
  const { status, url, data } = await request(`/projects/${encodeURIComponent(id)}`, {
    method: 'GET',
    ...options,
  });
  assertProjectRecord(data, status, url);
  return data;
}

export async function createProject(
  name: string,
  state: ProjectStatePayload,
  options: RequestOptions = {}
): Promise<ProjectRecord> {
  const { status, url, data } = await request('/projects', {
    ...options,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, state }),
  });
  assertProjectRecord(data, status, url);
  return data;
}

export async function updateProject(
  id: string,
  patch: ProjectPatch,
  options: RequestOptions = {}
): Promise<ProjectRecord> {
  const { status, url, data } = await request(`/projects/${encodeURIComponent(id)}`, {
    ...options,
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  assertProjectRecord(data, status, url);
  return data;
}

export async function deleteProject(id: string, options: RequestOptions = {}): Promise<void> {
  await request(`/projects/${encodeURIComponent(id)}`, {
    ...options,
    method: 'DELETE',
    ignoreBody: true,
  });
}

export async function uploadMedia(file: File, options: RequestOptions = {}): Promise<MediaUploadResult> {
  const body = new FormData();
  body.append('file', file, file.name);
  const { status, url, data } = await request('/media', { ...options, method: 'POST', body });
  // No manual content-type header: the browser supplies the multipart boundary.
  if (!isRecord(data) || typeof data.id !== 'string' || typeof data.url !== 'string') {
    throw new ApiError('Unexpected media upload payload from server', {
      status,
      code: 'invalid_response',
      url,
    });
  }
  return { id: data.id, url: data.url };
}

export function getMediaUrl(id: string, options: Pick<RequestOptions, 'baseUrl'> = {}): string {
  return buildUrl(options.baseUrl ?? DEFAULT_API_BASE, `/media/${encodeURIComponent(id)}`);
}
