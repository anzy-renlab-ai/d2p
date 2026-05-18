import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { runMigrations } from '../storage/migrations/index.js';
import {
  createMultiTurnDriver,
  defaultIsSelfReportedComplete,
  defaultContinuePrompt,
  __test__,
} from './multi-turn.js';
import type { StreamHandle, TurnDonePayload } from '../engines/claude-stream.js';
import { listCcTurnEvents, readScratchpad, getCcSession } from '../storage/cc-sessions.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

interface FakeStream {
  handle: StreamHandle;
  fireTurn: (text: string | null, opts?: { sessionId?: string; source?: 'hook' | 'result' }) => void;
  writeNextCalls: string[];
  finish: () => void; // emit 'exit' on the child
}

function makeFakeStream(): FakeStream {
  const child = new EventEmitter() as unknown as StreamHandle['child'];
  // ChildProcess uses removeListener; EventEmitter has it. Good.
  let turnIdx = 0;
  let sessionId: string | null = null;
  const writeNextCalls: string[] = [];

  const handle: StreamHandle = {
    runId: 'test-run',
    child,
    writeNextTurn(prompt: string): boolean {
      writeNextCalls.push(prompt);
      turnIdx += 1;
      return true;
    },
    getSessionId() {
      return sessionId;
    },
    getStats() {
      return { eventCount: 0, lastEventAt: null };
    },
  };

  return {
    handle,
    fireTurn(text, opts) {
      if (opts?.sessionId) sessionId = opts.sessionId;
      const payload: TurnDonePayload = {
        source: opts?.source ?? 'hook',
        turnIndex: turnIdx,
        sessionId,
        lastAssistantText: text,
        transcriptPath: null,
        stopHookActive: false,
        raw: { fake: true, text },
      };
      __test__.driverState.onTurn(payload);
    },
    writeNextCalls,
    finish() {
      child.emit('exit');
    },
  };
}

beforeEach(() => {
  __test__.driverState.onTurn = () => undefined;
});

describe('defaultIsSelfReportedComplete', () => {
  it.each([
    ['empty', '', false],
    ['noise', 'still working on it', false],
    ['中文 完成', '所有变更已完成，等 reviewer', true],
    ['done', 'all done', true],
    ['task complete', 'task complete, ready to review', true],
    ['self report', 'self-report: complete — middleware, tests, docs all done', true],
  ])('%s', (_label, text, expected) => {
    expect(defaultIsSelfReportedComplete(text)).toBe(expected);
  });
});

describe('defaultContinuePrompt', () => {
  it('mentions next turn index + ask for self-report', () => {
    const p = defaultContinuePrompt({ turnIndex: 2, lastAssistantText: null });
    expect(p).toContain('turn 3');
    expect(p).toContain('task complete');
  });
});

describe('turnDelta (stagnation heuristic)', () => {
  it('returns ~1 when one side is empty', () => {
    expect(__test__.turnDelta(null, 'hello')).toBe(1);
    expect(__test__.turnDelta('hello', null)).toBe(1);
  });

  it('returns 0 for identical strings (long enough for shingles)', () => {
    const s = 'a'.repeat(200);
    expect(__test__.turnDelta(s, s)).toBe(0);
  });

  it('returns >0 for very different strings', () => {
    const a = 'turn 1: scanned code and found 5 affected files in src/auth'.repeat(3);
    const b = 'turn 2: completely different content writing tests for billing'.repeat(3);
    expect(__test__.turnDelta(a, b)).toBeGreaterThan(0.5);
  });
});

describe('runMultiTurn — full integration with fake stream', () => {
  it('stops when implementer self-reports complete', async () => {
    const db = freshDb();
    const fake = makeFakeStream();
    const driver = createMultiTurnDriver();
    const p = driver.run(db, fake.handle, { runId: 'r1', role: 'implementer' });

    fake.fireTurn('working on turn 0…', { sessionId: 'cc-A' });
    fake.fireTurn('still progressing, partial fix in place', { sessionId: 'cc-A' });
    fake.fireTurn('all done — task complete', { sessionId: 'cc-A' });

    const result = await p;
    expect(result.reason).toBe('self-reported-complete');
    expect(result.turnsRan).toBe(3);
    expect(result.sessionId).toBe('cc-A');
    expect(fake.writeNextCalls.length).toBe(2); // continuePrompt fired after turn 0 + turn 1
  });

  it('stops at turn cap when never self-reports', async () => {
    const db = freshDb();
    const fake = makeFakeStream();
    const driver = createMultiTurnDriver();
    const p = driver.run(db, fake.handle, { runId: 'r2', role: 'implementer', maxTurns: 3 });

    // Fire 3 turns with varied content so stagnation doesn't fire first
    fake.fireTurn('turn 0: scanning files for the auth middleware change');
    fake.fireTurn('turn 1: drafting new middleware against fresh test fixtures');
    fake.fireTurn('turn 2: integrating with existing token loader and routes');

    const result = await p;
    expect(result.reason).toBe('turn-cap');
    expect(result.turnsRan).toBe(3);
  });

  it('stops on stagnation when consecutive turns repeat', async () => {
    const db = freshDb();
    const fake = makeFakeStream();
    const driver = createMultiTurnDriver();
    const p = driver.run(db, fake.handle, { runId: 'r3', role: 'implementer', maxTurns: 99 });

    const same = 'thinking about how to approach this gap. need to write the middleware and tests then verify. '.repeat(5);
    fake.fireTurn(same);
    fake.fireTurn(same);
    fake.fireTurn(same);

    const result = await p;
    expect(result.reason).toBe('stagnation');
  });

  it('stops on AbortSignal mid-stream', async () => {
    const db = freshDb();
    const fake = makeFakeStream();
    const driver = createMultiTurnDriver();
    const ac = new AbortController();
    const p = driver.run(db, fake.handle, { runId: 'r4', role: 'implementer', signal: ac.signal });

    fake.fireTurn('turn 0 progressing');
    ac.abort();

    const result = await p;
    expect(result.reason).toBe('aborted');
  });

  it('stops on stream-error when child exits early', async () => {
    const db = freshDb();
    const fake = makeFakeStream();
    const driver = createMultiTurnDriver();
    const p = driver.run(db, fake.handle, { runId: 'r5', role: 'implementer' });

    fake.fireTurn('turn 0');
    fake.finish(); // child emits 'exit'

    const result = await p;
    expect(result.reason).toBe('stream-error');
  });

  it('persists cc_sessions / cc_turn_events / cc_scratchpad as turns flow', async () => {
    const db = freshDb();
    const fake = makeFakeStream();
    const driver = createMultiTurnDriver();
    const p = driver.run(db, fake.handle, { runId: 'r6', role: 'implementer' });

    fake.fireTurn('first progress note here', { sessionId: 'cc-X' });
    fake.fireTurn('all done — task complete', { sessionId: 'cc-X' });

    await p;

    const sess = getCcSession(db, 'r6', 'implementer');
    expect(sess?.ccSessionId).toBe('cc-X');

    const events = listCcTurnEvents(db, 'r6');
    expect(events.length).toBeGreaterThanOrEqual(2);

    const pad = readScratchpad(db, 'r6');
    expect(pad).toHaveLength(2);
    expect(pad[0]!.text).toContain('first progress note');
  });
});
