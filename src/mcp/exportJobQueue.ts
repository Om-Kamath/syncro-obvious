/**
 * Server-side export job queue backing the `trigger_export` MCP tool.
 *
 * Deliberately storage-free and transport-agnostic: this module owns the
 * export-job lifecycle (enqueue, poll, validated status transitions) shared by
 * the MCP layer and the render worker that advances jobs. Persistence belongs
 * to the projects/media storage, not to this queue.
 */
import type { ExportPresetId } from '../utils/exportPresets';

/** Lifecycle of a server-side export job. Terminal states never transition again. */
export type ExportJobStatus = 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled';

/**
 * Render quality of a server-side export job. Defined here rather than in the
 * client presets because it describes the server render, not a UI option.
 */
export type ExportQuality = 'low' | 'medium' | 'high' | 'source';

export const EXPORT_QUALITIES: readonly ExportQuality[] = ['low', 'medium', 'high', 'source'];

/** Quality used when the caller omits it: an agent-driven export is never silently downgraded. */
export const DEFAULT_EXPORT_QUALITY: ExportQuality = 'source';

export interface ExportJob {
  id: string;
  projectId: string;
  preset: ExportPresetId;
  quality: ExportQuality;
  status: ExportJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Populated when the job fails. */
  error?: string;
}

/** Compact payload for status polls — what a poller needs, nothing more. */
export interface ExportJobStatusView {
  id: string;
  status: ExportJobStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

/** Raised for unknown ids, invalid transitions, and invalid enqueues. */
export class ExportJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportJobError';
  }
}

const VALID_TRANSITIONS: Record<ExportJobStatus, readonly ExportJobStatus[]> = {
  queued: ['rendering', 'cancelled'],
  rendering: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const TERMINAL_STATUSES: readonly ExportJobStatus[] = ['completed', 'failed', 'cancelled'];

export interface ExportJobStoreDeps {
  /** Job id source; defaults to crypto.randomUUID(). */
  generateId?: () => string;
  /** ISO timestamp source; defaults to the system clock. */
  now?: () => string;
}

export interface ExportJobStore {
  enqueue(input: { projectId: string; preset: ExportPresetId; quality?: ExportQuality }): ExportJob;
  /** Full job record, for workers and detail views. */
  get(id: string): ExportJob | undefined;
  /** Compact poll shape for status checks. */
  getJobStatus(id: string): ExportJobStatusView | undefined;
  /** All jobs for one project, in enqueue order. */
  listByProject(projectId: string): ExportJob[];
  /** Advance a job's status; stamps startedAt/finishedAt and records an error patch. */
  transition(id: string, status: Exclude<ExportJobStatus, 'queued'>, patch?: { error?: string }): ExportJob;
}

export function createExportJobStore(deps: ExportJobStoreDeps = {}): ExportJobStore {
  const generateId = deps.generateId ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => new Date().toISOString());
  const jobs = new Map<string, ExportJob>();

  // Jobs are copied on the way out so callers cannot mutate queue state.
  return {
    enqueue(input) {
      if (typeof input.projectId !== 'string' || input.projectId.trim().length === 0) {
        throw new ExportJobError('projectId must be a non-empty string.');
      }
      const timestamp = now();
      const job: ExportJob = {
        id: generateId(),
        projectId: input.projectId,
        preset: input.preset,
        quality: input.quality ?? DEFAULT_EXPORT_QUALITY,
        status: 'queued',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      jobs.set(job.id, job);
      return { ...job };
    },

    get(id) {
      const job = jobs.get(id);
      return job ? { ...job } : undefined;
    },

    getJobStatus(id) {
      const job = jobs.get(id);
      if (!job) return undefined;
      const view: ExportJobStatusView = {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };
      if (job.error !== undefined) view.error = job.error;
      return view;
    },

    listByProject(projectId) {
      return [...jobs.values()]
        .filter((job) => job.projectId === projectId)
        .map((job) => ({ ...job }));
    },

    transition(id, status, patch) {
      const job = jobs.get(id);
      if (!job) throw new ExportJobError(`Unknown export job: ${id}`);
      if (!VALID_TRANSITIONS[job.status].includes(status)) {
        throw new ExportJobError(`Invalid transition ${job.status} -> ${status} for export job ${id}.`);
      }
      job.status = status;
      job.updatedAt = now();
      if (status === 'rendering') job.startedAt = job.updatedAt;
      if (TERMINAL_STATUSES.includes(status)) job.finishedAt = job.updatedAt;
      if (patch?.error !== undefined) job.error = patch.error;
      return { ...job };
    },
  };
}
