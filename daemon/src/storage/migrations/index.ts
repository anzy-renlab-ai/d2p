import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { m001Init } from './001-init.js';
import { m002Presets } from './002-presets.js';
import { m003Cost } from './003-cost.js';

export interface Migration {
  version: number;
  name: string;
  upSql: string;
}

export interface MigrationWithChecksum extends Migration {
  checksum: string;
}

function withChecksum(m: Migration): MigrationWithChecksum {
  return { ...m, checksum: createHash('sha256').update(m.upSql).digest('hex') };
}

export const ALL_MIGRATIONS: readonly MigrationWithChecksum[] = [
  withChecksum(m001Init),
  withChecksum(m002Presets),
  withChecksum(m003Cost),
] as const;

export class MigrationChecksumDriftError extends Error {
  constructor(version: number, name: string, applied: string, expected: string) {
    super(`checksum drift on migration ${version} (${name}): applied=${applied} expected=${expected}`);
    this.name = 'MigrationChecksumDriftError';
  }
}

export class UnknownMigrationError extends Error {
  constructor(version: number) {
    super(`unknown applied migration: ${version}`);
    this.name = 'UnknownMigrationError';
  }
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
  const appliedRows = db
    .prepare('SELECT version FROM schema_migrations')
    .all() as { version: number }[];
  const applied = new Set(appliedRows.map((r) => r.version));

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
  );

  for (const m of ALL_MIGRATIONS) {
    if (applied.has(m.version)) continue;
    const tx = db.transaction(() => {
      db.exec(m.upSql);
      insertMigration.run(m.version, m.name, m.checksum, Date.now());
    });
    tx();
  }
}

export function verifyChecksums(db: Database.Database): void {
  const rows = db
    .prepare('SELECT version, name, checksum FROM schema_migrations')
    .all() as { version: number; name: string; checksum: string }[];
  for (const row of rows) {
    const expected = ALL_MIGRATIONS.find((m) => m.version === row.version);
    if (!expected) throw new UnknownMigrationError(row.version);
    if (expected.checksum !== row.checksum) {
      throw new MigrationChecksumDriftError(row.version, row.name, row.checksum, expected.checksum);
    }
  }
}
