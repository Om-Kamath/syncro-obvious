/**
 * Versioned schema migrations for the Syncro server database.
 *
 * Each entry's `up` SQL is applied exactly once, inside a transaction, by
 * runMigrations() (see ./migrate). Never edit a migration that has shipped —
 * add a new entry with a higher version instead.
 */
export interface Migration {
  /** Monotonic, strictly increasing version number. */
  version: number;
  /** Short snake_case name, recorded in schema_migrations next to the version. */
  name: string;
  /** SQL applied atomically when this version runs. */
  up: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'create_projects_and_media',
    up: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        state TEXT NOT NULL CHECK (json_valid(state)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX idx_projects_updated_at ON projects (updated_at);

      CREATE TABLE media (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        bytes BLOB NOT NULL,
        mime TEXT NOT NULL
      );

      CREATE INDEX idx_media_project_id ON media (project_id);
    `,
  },
];
