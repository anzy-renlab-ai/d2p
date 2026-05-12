import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync } from 'node:fs';

export function defaultDbPath(): string {
  return process.env.D2P_DB_PATH ?? path.join(os.homedir(), '.d2p', 'state.db');
}

export function openDatabase(dbPath: string = defaultDbPath()): Database.Database {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function integrityCheck(db: Database.Database): boolean {
  const r = db.pragma('integrity_check', { simple: true });
  return r === 'ok';
}
