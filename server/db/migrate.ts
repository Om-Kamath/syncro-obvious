import Database from 'better-sqlite3';
import type { Migration } from './migrations';
import { migrations } from './migrations';

type Db = Database.Database;

/** A migration applied by runMigrations, returned in application order. */
export interface AppliedMigration {
  version: number;
  name: string;
}

interface SchemaMigrationRow {
  version: number;
  name: string;
}

const ENSURE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`;

/**
 * Open a Syncro database and configure the connection pragmas.
 * Defaults to an in-memory database (tests, throwaway tooling); the server
 * passes a file path. Foreign-key enforcement is requested explicitly so the
 * media -> projects cascade never depends on the SQLite build's default.
 */
export function openDatabase(filename = ':memory:'): Db {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  if (filename !== ':memory:') {
    // WAL keeps readers and the single writer from blocking each other.
    db.pragma('journal_mode = WAL');
  }
  return db;
}

/**
 * Apply every migration not yet recorded in schema_migrations, oldest first.
 * Each migration runs in its own transaction: a failure rolls that migration
 * back completely (DDL included) and stops the run — earlier migrations stay
 * applied. Returns the migrations applied by this call, in order; an
 * already-migrated database returns [].
 */
export function runMigrations(db: Db, list: readonly Migration[] = migrations): AppliedMigration[] {
  const listed = new Set<number>();
  for (const migration of list) {
    if (listed.has(migration.version)) {
      throw new Error(`Duplicate migration version ${migration.version}: ${migration.name}`);
    }
    listed.add(migration.version);
  }

  db.exec(ENSURE_MIGRATIONS_TABLE);
  const rows = db.prepare('SELECT version, name FROM schema_migrations').all() as SchemaMigrationRow[];
  const appliedVersions = new Set(rows.map((row) => row.version));

  const applied: AppliedMigration[] = [];
  for (const migration of [...list].sort((a, b) => a.version - b.version)) {
    if (appliedVersions.has(migration.version)) continue;
    const apply = db.transaction(() => {
      db.exec(migration.up);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
    });
    apply();
    applied.push({ version: migration.version, name: migration.name });
  }
  return applied;
}
