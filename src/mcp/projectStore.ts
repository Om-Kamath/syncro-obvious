import type { TimelineProjectState } from './timeline';

/**
 * Minimal read interface the MCP tools need from project storage. The
 * SQLite-backed store lands with the saved-projects API; until then the
 * in-memory implementation keeps the server, tests, and local runs
 * self-contained.
 */
export interface ProjectStore {
  getProject(projectId: string): Promise<TimelineProjectState | null>;
}

/** In-memory ProjectStore for tests and local demos — nothing persists. */
export class InMemoryProjectStore implements ProjectStore {
  private projects = new Map<string, TimelineProjectState>();

  getProject(projectId: string): Promise<TimelineProjectState | null> {
    return Promise.resolve(this.projects.get(projectId) ?? null);
  }

  /** Seed or replace a project record. */
  put(project: TimelineProjectState): this {
    this.projects.set(project.id, project);
    return this;
  }
}
