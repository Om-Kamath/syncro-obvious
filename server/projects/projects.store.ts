import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { ProjectState } from './projectState';

export interface ProjectRecord {
  id: string;
  name: string;
  state: ProjectState;
  createdAt: string;
  updatedAt: string;
}

interface ProjectRow {
  id: string;
  name: string;
  state: string;
  created_at: string;
  updated_at: string;
}

/** Stored state JSON was validated by `parseProjectState` on the way in, so the cast is safe. */
function toRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    state: JSON.parse(row.state) as ProjectState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * SQLite-backed store for saved projects. Rows live in the `projects` table
 * created by the schema migrations (PR 23); this store assumes migrations
 * have already run and never alters the schema itself.
 */
export class ProjectsStore {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  create(name: string, state: ProjectState): ProjectRecord {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare('INSERT INTO projects (id, name, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, JSON.stringify(state), createdAt, createdAt);
    return { id, name, state, createdAt, updatedAt: createdAt };
  }

  /** Most recently updated first — the order a project-picker UI wants. */
  list(): ProjectRecord[] {
    const rows = this.db
      .prepare('SELECT id, name, state, created_at, updated_at FROM projects ORDER BY updated_at DESC')
      .all() as ProjectRow[];
    return rows.map(toRecord);
  }

  get(id: string): ProjectRecord | undefined {
    const row = this.db
      .prepare('SELECT id, name, state, created_at, updated_at FROM projects WHERE id = ?')
      .get(id) as ProjectRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  update(id: string, name: string, state: ProjectState): ProjectRecord | undefined {
    const updatedAt = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE projects SET name = ?, state = ?, updated_at = ? WHERE id = ?')
      .run(name, JSON.stringify(state), updatedAt, id);
    if (result.changes === 0) return undefined;
    return this.get(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
