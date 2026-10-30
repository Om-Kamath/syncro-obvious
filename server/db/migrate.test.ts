import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Migration } from './migrations';
import { openDatabase, runMigrations } from './migrate';

type Db = Database.Database;

interface ColumnInfo {
  name: string;
  notnull: number;
  pk: number;
}

interface TableNameRow {
  name: string;
}

/** Column definitions of a table, in declared order. */
function tableColumns(db: Db, table: string): ColumnInfo[] {
  return db.pragma(`table_info(${table})`) as ColumnInfo[];
}

/** All user table names in the database. */
function tableNames(db: Db): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as TableNameRow[]).map(
    (row) => row.name,
  );
}

describe('runMigrations with the shipped schema (in-memory)', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase();
    runMigrations(db);
  });

  it('creates the projects table with the expected columns', () => {
    const columns = tableColumns(db, 'projects');
    expect(columns.map((column) => column.name)).toEqual(['id', 'name', 'state', 'created_at', 'updated_at']);
    expect(columns.filter((column) => column.pk === 1).map((column) => column.name)).toEqual(['id']);
    for (const column of columns) {
      expect(column.notnull, `projects.${column.name} must be NOT NULL`).toBe(1);
    }
  });

  it('creates the media table with the expected columns', () => {
    const columns = tableColumns(db, 'media');
    expect(columns.map((column) => column.name)).toEqual(['id', 'project_id', 'kind', 'bytes', 'mime']);
    expect(columns.filter((column) => column.pk === 1).map((column) => column.name)).toEqual(['id']);
    for (const column of columns) {
      expect(column.notnull, `media.${column.name} must be NOT NULL`).toBe(1);
    }
  });

  it('creates the indexes the API queries need', () => {
    const indexNames = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IS NOT NULL").all() as TableNameRow[]
    ).map((row) => row.name);
    expect(indexNames).toContain('idx_projects_updated_at');
    expect(indexNames).toContain('idx_media_project_id');
  });

  it('records each applied version in schema_migrations with a timestamp', () => {
    const rows = db.prepare('SELECT version, name, applied_at FROM schema_migrations').all() as Array<{
      version: number;
      name: string;
      applied_at: string;
    }>;
    expect(rows).toEqual([{ version: 1, name: 'create_projects_and_media', applied_at: expect.any(String) }]);
    expect(new Date(rows[0].applied_at).getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it('is idempotent — a second run applies nothing and changes nothing', () => {
    expect(runMigrations(db)).toEqual([]);
    expect(runMigrations(db)).toEqual([]);
    const rows = db.prepare('SELECT version FROM schema_migrations').all();
    expect(rows).toHaveLength(1);
    expect(tableColumns(db, 'projects').map((column) => column.name)).toEqual([
      'id',
      'name',
      'state',
      'created_at',
      'updated_at',
    ]);
  });

  it('rejects project state that is not valid JSON', () => {
    const insert = db.prepare('INSERT INTO projects (id, name, state) VALUES (?, ?, ?)');
    expect(() => insert.run('p-bad', 'Broken state', '{not json')).toThrow();
    const row = db.prepare('SELECT COUNT(*) AS count FROM projects').get() as { count: number };
    expect(row.count).toBe(0);
  });

  it('round-trips structured project state unchanged', () => {
    const state = {
      clips: [{ id: 'clip-1', name: 'intro.mp4', trimStart: 0.5 }],
      voiceover: { transcription: 'hello world' },
      captionStyle: { fontSize: 48, mode: 'word-highlight' },
    };
    db.prepare('INSERT INTO projects (id, name, state) VALUES (?, ?, ?)').run('p-1', 'Launch video', JSON.stringify(state));
    const row = db.prepare('SELECT state FROM projects WHERE id = ?').get('p-1') as { state: string };
    expect(JSON.parse(row.state)).toEqual(state);
  });

  it('rejects NULL ids despite TEXT primary keys (SQLite legacy quirk)', () => {
    const insert = db.prepare('INSERT INTO projects (id, name, state) VALUES (?, ?, ?)');
    expect(() => insert.run(null, 'No id', '{}')).toThrow();
  });

  it('defaults created_at and updated_at to ISO-8601 UTC instants', () => {
    db.prepare('INSERT INTO projects (id, name, state) VALUES (?, ?, ?)').run('p-2', 'Timed', '{}');
    const row = db.prepare('SELECT created_at, updated_at FROM projects WHERE id = ?').get('p-2') as {
      created_at: string;
      updated_at: string;
    };
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Math.abs(Date.now() - new Date(row.created_at).getTime())).toBeLessThan(5000);
  });

  it('stores and returns binary blobs unchanged', () => {
    db.prepare('INSERT INTO projects (id, name, state) VALUES (?, ?, ?)').run('p-3', 'Media host', '{}');
    const payload = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x80]);
    db.prepare('INSERT INTO media (id, project_id, kind, bytes, mime) VALUES (?, ?, ?, ?, ?)').run(
      'm-1',
      'p-3',
      'video',
      payload,
      'video/mp4',
    );
    const row = db.prepare('SELECT bytes FROM media WHERE id = ?').get('m-1') as { bytes: Buffer };
    expect(Buffer.from(row.bytes)).toEqual(payload);
  });

  it('deletes a project’s media when the project is deleted (FK cascade)', () => {
    db.prepare('INSERT INTO projects (id, name, state) VALUES (?, ?, ?)').run('p-4', 'With media', '{}');
    const insertMedia = db.prepare('INSERT INTO media (id, project_id, kind, bytes, mime) VALUES (?, ?, ?, ?, ?)');
    insertMedia.run('m-2', 'p-4', 'video', Buffer.alloc(4), 'video/mp4');
    insertMedia.run('m-3', 'p-4', 'audio', Buffer.alloc(4), 'audio/mpeg');

    db.prepare('DELETE FROM projects WHERE id = ?').run('p-4');
    const row = db.prepare('SELECT COUNT(*) AS count FROM media').get() as { count: number };
    expect(row.count).toBe(0);
  });

  it('rejects media referencing a project that does not exist', () => {
    db.prepare('INSERT INTO projects (id, name, state) VALUES (?, ?, ?)').run('p-5', 'Lone project', '{}');
    const insertMedia = db.prepare('INSERT INTO media (id, project_id, kind, bytes, mime) VALUES (?, ?, ?, ?, ?)');
    expect(() => insertMedia.run('m-9', 'ghost-project', 'video', Buffer.alloc(4), 'video/mp4')).toThrow(
      /FOREIGN KEY/i,
    );
  });
});

describe('runMigrations runner semantics', () => {
  it('applies an out-of-order list in ascending version order', () => {
    const db = openDatabase();
    const list: Migration[] = [
      { version: 3, name: 'third', up: 'CREATE TABLE t3 (id INTEGER)' },
      { version: 1, name: 'first', up: 'CREATE TABLE t1 (id INTEGER)' },
      { version: 2, name: 'second', up: 'CREATE TABLE t2 (id INTEGER)' },
    ];
    expect(runMigrations(db, list)).toEqual([
      { version: 1, name: 'first' },
      { version: 2, name: 'second' },
      { version: 3, name: 'third' },
    ]);
    const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY rowid').all() as Array<{ version: number }>;
    expect(rows.map((row) => row.version)).toEqual([1, 2, 3]);
  });

  it('rolls back a failed migration atomically and allows a fixed re-run', () => {
    const db = openDatabase();
    const list: Migration[] = [
      { version: 1, name: 'good', up: 'CREATE TABLE good (id INTEGER)' },
      { version: 2, name: 'bad', up: 'CREATE TABLE half_written (id INTEGER); CREATE TABLE broken (' },
    ];
    expect(() => runMigrations(db, list)).toThrow();

    // The failed migration left nothing behind; the earlier one is committed.
    const tables = tableNames(db);
    expect(tables).toContain('good');
    expect(tables).not.toContain('half_written');
    const rows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
    expect(rows.map((row) => row.version)).toEqual([1]);

    // Fixing the bad migration applies only the pending version.
    const fixed: Migration[] = [
      { version: 1, name: 'good', up: 'CREATE TABLE good (id INTEGER)' },
      { version: 2, name: 'fixed', up: 'CREATE TABLE fixed (id INTEGER)' },
    ];
    expect(runMigrations(db, fixed)).toEqual([{ version: 2, name: 'fixed' }]);
    expect(tableNames(db)).toContain('fixed');
  });

  it('rejects duplicate versions in the list instead of silently skipping', () => {
    const db = openDatabase();
    const list: Migration[] = [
      { version: 1, name: 'one', up: 'CREATE TABLE one (id INTEGER)' },
      { version: 1, name: 'one-again', up: 'CREATE TABLE one_again (id INTEGER)' },
    ];
    expect(() => runMigrations(db, list)).toThrow(/duplicate migration version 1/i);
  });
});

describe('openDatabase', () => {
  it('opens isolated in-memory databases by default', () => {
    const first = openDatabase();
    runMigrations(first);
    first.prepare('INSERT INTO projects (id, name, state) VALUES (?, ?, ?)').run('p-a', 'First', '{}');

    const second = openDatabase();
    runMigrations(second);
    const row = second.prepare('SELECT COUNT(*) AS count FROM projects').get() as { count: number };
    expect(row.count).toBe(0);
  });
});
