import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrations/index.js';
import {
  upsertCcSession,
  getCcSession,
  deleteCcSessionsForRun,
  appendCcTurnEvent,
  listCcTurnEvents,
  writeScratchpadNote,
  readScratchpad,
  clearScratchpadForRun,
} from './cc-sessions.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('cc_sessions storage', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  describe('cc_sessions', () => {
    it('returns null when no row exists', () => {
      expect(getCcSession(db, 'run-1', 'implementer')).toBeNull();
    });

    it('upsert then get round-trips the session id + turn idx', () => {
      upsertCcSession(db, {
        runId: 'run-1',
        role: 'implementer',
        ccSessionId: 'cc-sess-abc',
        turnIdx: 3,
      });
      const r = getCcSession(db, 'run-1', 'implementer');
      expect(r).not.toBeNull();
      expect(r!.ccSessionId).toBe('cc-sess-abc');
      expect(r!.lastTurnIdx).toBe(3);
    });

    it('upsert replaces existing session id for same (run_id, role)', () => {
      upsertCcSession(db, {
        runId: 'run-1',
        role: 'implementer',
        ccSessionId: 'cc-sess-old',
        turnIdx: 1,
      });
      upsertCcSession(db, {
        runId: 'run-1',
        role: 'implementer',
        ccSessionId: 'cc-sess-new',
        turnIdx: 4,
      });
      const r = getCcSession(db, 'run-1', 'implementer');
      expect(r!.ccSessionId).toBe('cc-sess-new');
      expect(r!.lastTurnIdx).toBe(4);
    });

    it('different (run_id, role) pairs do not collide', () => {
      upsertCcSession(db, {
        runId: 'run-1',
        role: 'implementer',
        ccSessionId: 'cc-A',
        turnIdx: 1,
      });
      upsertCcSession(db, {
        runId: 'run-1',
        role: 'reviewer',
        ccSessionId: 'cc-B',
        turnIdx: 1,
      });
      upsertCcSession(db, {
        runId: 'run-2',
        role: 'implementer',
        ccSessionId: 'cc-C',
        turnIdx: 1,
      });
      expect(getCcSession(db, 'run-1', 'implementer')!.ccSessionId).toBe('cc-A');
      expect(getCcSession(db, 'run-1', 'reviewer')!.ccSessionId).toBe('cc-B');
      expect(getCcSession(db, 'run-2', 'implementer')!.ccSessionId).toBe('cc-C');
    });

    it('deleteCcSessionsForRun wipes only that run', () => {
      upsertCcSession(db, {
        runId: 'run-1',
        role: 'implementer',
        ccSessionId: 'cc-A',
        turnIdx: 1,
      });
      upsertCcSession(db, {
        runId: 'run-2',
        role: 'implementer',
        ccSessionId: 'cc-B',
        turnIdx: 1,
      });
      deleteCcSessionsForRun(db, 'run-1');
      expect(getCcSession(db, 'run-1', 'implementer')).toBeNull();
      expect(getCcSession(db, 'run-2', 'implementer')).not.toBeNull();
    });
  });

  describe('cc_turn_events', () => {
    it('appends and lists in insertion order', () => {
      appendCcTurnEvent(db, { runId: 'r1', turnIdx: 1, source: 'session-start', payload: { sid: 'abc' } });
      appendCcTurnEvent(db, { runId: 'r1', turnIdx: 1, source: 'stop', payload: { reason: 'ok' } });
      appendCcTurnEvent(db, { runId: 'r1', turnIdx: 2, source: 'stop', payload: { reason: 'ok' } });
      const events = listCcTurnEvents(db, 'r1');
      expect(events).toHaveLength(3);
      expect(events[0]!.source).toBe('session-start');
      expect(events[2]!.turnIdx).toBe(2);
    });

    it('payload_json round-trips via JSON', () => {
      appendCcTurnEvent(db, {
        runId: 'r1',
        turnIdx: 1,
        source: 'stop',
        payload: { nested: { a: 1, b: [2, 3] } },
      });
      const events = listCcTurnEvents(db, 'r1');
      const parsed = JSON.parse(events[0]!.payloadJson);
      expect(parsed.nested.a).toBe(1);
      expect(parsed.nested.b).toEqual([2, 3]);
    });

    it('sinceId filter skips already-seen events', () => {
      const id1 = appendCcTurnEvent(db, { runId: 'r1', turnIdx: 1, source: 'session-start', payload: {} });
      const id2 = appendCcTurnEvent(db, { runId: 'r1', turnIdx: 1, source: 'stop', payload: {} });
      appendCcTurnEvent(db, { runId: 'r1', turnIdx: 2, source: 'stop', payload: {} });
      const after1 = listCcTurnEvents(db, 'r1', { sinceId: id1 });
      expect(after1).toHaveLength(2);
      const after2 = listCcTurnEvents(db, 'r1', { sinceId: id2 });
      expect(after2).toHaveLength(1);
    });

    it('different runs are isolated', () => {
      appendCcTurnEvent(db, { runId: 'r1', turnIdx: 1, source: 'stop', payload: {} });
      appendCcTurnEvent(db, { runId: 'r2', turnIdx: 1, source: 'stop', payload: {} });
      expect(listCcTurnEvents(db, 'r1')).toHaveLength(1);
      expect(listCcTurnEvents(db, 'r2')).toHaveLength(1);
    });

    it('rejects unknown source via CHECK constraint', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO cc_turn_events(run_id, turn_idx, source, payload_json, ts)
             VALUES ('r1', 1, 'not-a-source', '{}', 0)`,
          )
          .run(),
      ).toThrow();
    });
  });

  describe('cc_scratchpad', () => {
    it('writes and reads notes in ts order', () => {
      writeScratchpadNote(db, { runId: 'r1', turnIdx: 1, text: 'first', ts: 100 });
      writeScratchpadNote(db, { runId: 'r1', turnIdx: 2, text: 'second', ts: 200 });
      writeScratchpadNote(db, { runId: 'r1', turnIdx: 3, text: 'third', ts: 300 });
      const notes = readScratchpad(db, 'r1');
      expect(notes.map((n) => n.text)).toEqual(['first', 'second', 'third']);
    });

    it('isolates by runId', () => {
      writeScratchpadNote(db, { runId: 'r1', turnIdx: 1, text: 'r1 note' });
      writeScratchpadNote(db, { runId: 'r2', turnIdx: 1, text: 'r2 note' });
      expect(readScratchpad(db, 'r1').map((n) => n.text)).toEqual(['r1 note']);
      expect(readScratchpad(db, 'r2').map((n) => n.text)).toEqual(['r2 note']);
    });

    it('clearScratchpadForRun wipes only that run', () => {
      writeScratchpadNote(db, { runId: 'r1', turnIdx: 1, text: 'r1' });
      writeScratchpadNote(db, { runId: 'r2', turnIdx: 1, text: 'r2' });
      clearScratchpadForRun(db, 'r1');
      expect(readScratchpad(db, 'r1')).toHaveLength(0);
      expect(readScratchpad(db, 'r2')).toHaveLength(1);
    });
  });
});
