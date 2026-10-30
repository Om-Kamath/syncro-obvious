/**
 * Minimal read-side contract for saved projects, consumed by the MCP server.
 *
 * `state` is intentionally opaque (`unknown`): the write path owns validation
 * and the MCP layer only serializes what the store returns. Any store whose
 * `list()`/`get()` return records of this shape — including the SQLite-backed
 * ProjectsStore — satisfies `ProjectReader` structurally.
 */
export interface StoredProject {
  id: string;
  name: string;
  state: unknown;
  /** ISO-8601 timestamp of project creation. */
  createdAt: string;
  /** ISO-8601 timestamp of the last update. */
  updatedAt: string;
}

export interface ProjectReader {
  /** All projects, most recently updated first. */
  list(): StoredProject[];
  get(id: string): StoredProject | undefined;
}

/**
 * In-memory `ProjectReader` backing tests and the stdio entry. The resource
 * layer never mutates it — mutation is a store concern, not an MCP concern.
 */
export class InMemoryProjectStore implements ProjectReader {
  private readonly projects = new Map<string, StoredProject>();

  constructor(seed: StoredProject[] = []) {
    for (const project of seed) this.projects.set(project.id, project);
  }

  add(project: StoredProject): void {
    this.projects.set(project.id, project);
  }

  list(): StoredProject[] {
    return [...this.projects.values()].sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
  }

  get(id: string): StoredProject | undefined {
    return this.projects.get(id);
  }
}
