import type { ProjectPayload, ProjectRecord } from './types';

/**
 * Typed failure modes of the projects API. The MCP layer maps each kind to a
 * distinct tool-result message so an agent can tell "fix your payload"
 * (validation) from "wrong id" (notFound) from "server down" (unavailable).
 */
export type ProjectApiErrorKind = 'validation' | 'notFound' | 'unavailable' | 'unexpected';

export class ProjectApiError extends Error {
  readonly kind: ProjectApiErrorKind;
  readonly status?: number;

  constructor(kind: ProjectApiErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ProjectApiError';
    this.kind = kind;
    this.status = status;
  }
}

/** Port the MCP tools depend on; the HTTP adapter is the production implementation. */
export interface ProjectsApi {
  create(payload: ProjectPayload): Promise<ProjectRecord>;
  update(id: string, payload: ProjectPayload): Promise<ProjectRecord>;
  remove(id: string): Promise<void>;
}

type UnknownRecord = Record<string, unknown>;

async function readErrorBody(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as unknown;
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const message = (body as UnknownRecord).error;
      if (typeof message === 'string') return message;
    }
  } catch {
    // Fall through: non-JSON error body — report the status line instead.
  }
  return `Syncro API responded ${res.status} ${res.statusText}`;
}

/**
 * REST adapter over the Syncro projects API (`POST/PUT/DELETE /api/projects`).
 * The API validates payloads itself, so a 400 is mapped to the same
 * 'validation' kind a locally-rejected payload produces.
 */
export class HttpProjectsApi implements ProjectsApi {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    // Strip the trailing slash so `new URL(path, base)` never double-slashes.
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
  }

  async create(payload: ProjectPayload): Promise<ProjectRecord> {
    return this.readJson(await this.request('POST', '/api/projects', payload));
  }

  async update(id: string, payload: ProjectPayload): Promise<ProjectRecord> {
    return this.readJson(await this.request('PUT', `/api/projects/${encodeURIComponent(id)}`, payload));
  }

  async remove(id: string): Promise<void> {
    // 204 No Content by contract — nothing to read.
    await this.request('DELETE', `/api/projects/${encodeURIComponent(id)}`);
  }

  /** Performs the call and maps every non-2xx response to a ProjectApiError. */
  private async request(method: string, path: string, payload?: ProjectPayload): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(new URL(path, this.baseUrl).toString(), {
        method,
        headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    } catch (error) {
      throw new ProjectApiError(
        'unavailable',
        `could not reach the Syncro API at ${this.baseUrl} (${error instanceof Error ? error.message : String(error)}) — is \`npm run server:start\` running?`,
      );
    }

    if (res.ok) return res;

    const detail = await readErrorBody(res);
    if (res.status === 400) throw new ProjectApiError('validation', detail, res.status);
    if (res.status === 404) throw new ProjectApiError('notFound', detail, res.status);
    throw new ProjectApiError('unexpected', detail, res.status);
  }

  private async readJson(res: Response): Promise<ProjectRecord> {
    try {
      return (await res.json()) as ProjectRecord;
    } catch (error) {
      throw new ProjectApiError('unexpected', `Syncro API returned a malformed project body: ${String(error)}`, res.status);
    }
  }
}
