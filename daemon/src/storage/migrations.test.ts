import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, verifyChecksums, ALL_MIGRATIONS } from './migrations/index.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('migrations', () => {
  it('applies all migrations on empty db', () => {
    const db = freshDb();
    runMigrations(db);
    const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    expect(rows).toHaveLength(ALL_MIGRATIONS.length);
  });

  it('is idempotent', () => {
    const db = freshDb();
    runMigrations(db);
    runMigrations(db);
    runMigrations(db);
    const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    expect(rows).toHaveLength(ALL_MIGRATIONS.length);
  });

  it('verifyChecksums passes after fresh run', () => {
    const db = freshDb();
    runMigrations(db);
    expect(() => verifyChecksums(db)).not.toThrow();
  });

  it('verifyChecksums throws on tampered checksum', () => {
    const db = freshDb();
    runMigrations(db);
    db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('deadbeef');
    expect(() => verifyChecksums(db)).toThrow(/checksum drift/);
  });

  it('creates expected tables', () => {
    const db = freshDb();
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'cc_scratchpad',
        'cc_sessions',
        'cc_turn_events',
        'commit_risk',
        'cost_records',
        'demos',
        'fixes',
        'gaps',
        'log_events',
        'milestones',
        'preset_status_history',
        'repo_summaries',
        'reviews',
        'runs',
        'schema_migrations',
        'session_resume_marks',
        'sessions',
        'vision_drafts',
      ]),
    );
  });

  it('gaps.complexity column exists and defaults to simple', () => {
    const db = freshDb();
    runMigrations(db);
    const cols = db.prepare("PRAGMA table_info(gaps)").all() as {
      name: string;
      dflt_value: string | null;
    }[];
    const complexity = cols.find((c) => c.name === 'complexity');
    expect(complexity).toBeDefined();
    expect(complexity!.dflt_value).toContain('simple');
  });
});
