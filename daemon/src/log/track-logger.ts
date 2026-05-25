/**
 * ZeroU log module — per-track × per-trace structured JSONL logger.
 *
 * Surface authority: `docs/details/12-log-module-public-surface.md` @ commit 5eee600.
 * Phase 2 implementation lives at `daemon/src/log/`. Phase 3 target path is
 * `core/log/`.
 *
 * This file grows incrementally via TDD red-green per behavior B-1-1 → B-8-1.
 */

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  track: string;
  trace: string;
  scope?: string;
  event: string;
  [key: string]: unknown;
}

export interface TrackLogger {
  readonly track: string;
  readonly trace: string;
  log(level: LogLevel, event: string, data?: Record<string, unknown>): void;
  child(scope: string): TrackLogger;
  flush(): Promise<void>;
}

export interface CreateTrackLoggerOptions {
  logRoot?: string;
}

// ── LogError — surface-defined Error subclass with code field ────────────────

export type LogErrorCode = 'LOG-E-1' | 'LOG-E-2' | 'LOG-E-3' | 'LOG-E-4' | 'LOG-E-5';

export class LogError extends Error {
  readonly code: LogErrorCode;
  constructor(code: LogErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'LogError';
    this.code = code;
  }
}

// ── Track / scope name validation (LOG-E-3) ──────────────────────────────────

function validateScopeName(scope: string): void {
  if (scope === '' || scope.includes('/') || scope.includes('\\') || scope.startsWith('.')) {
    throw new LogError('LOG-E-3', `invalid scope name "${scope}"`);
  }
}

// ── ULID (Crockford base32, 26 chars) ────────────────────────────────────────
//
// Inlined to keep this module's runtime deps at Node stdlib only (per spec §4.7).
// 10-char timestamp + 16-char random. Random component uses `crypto.randomBytes`
// (lead Phase-2 milestone-1 decision: avoid Math.random birthday-collision risk
// for Phase 3's parallel-track audit trail identifiers).

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateUlid(): string {
  const ms = Date.now();
  let timePart = '';
  let t = ms;
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[t % 32]! + timePart;
    t = Math.floor(t / 32);
  }
  // 16 chars of Crockford base32 = 80 random bits. randomBytes(10) gives 80 bits.
  const buf = randomBytes(10);
  let randPart = '';
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < 10 && randPart.length < 16; i++) {
    acc = (acc << 8) | buf[i]!;
    bits += 8;
    while (bits >= 5 && randPart.length < 16) {
      bits -= 5;
      randPart += CROCKFORD[(acc >>> bits) & 0x1f]!;
    }
  }
  return timePart + randPart;
}

// ── Local-time YYYY-MM-DD ────────────────────────────────────────────────────
//
// Per surface "On-disk format": <YYYY-MM-DD> is local-time ISO calendar date,
// NOT UTC.

function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── TrackLoggerImpl ──────────────────────────────────────────────────────────

// ── Core: shared write infrastructure for a root + its descendants ──────────
//
// A LoggerCore is the per-(track, trace, logRoot) tuple. Multiple TrackLoggerImpl
// instances may share a LoggerCore (one root + N children); they all write to
// the same file with the same trace, differing only in `scope`.

interface LoggerCore {
  track: string;
  trace: string;
  logRoot: string;
  stream: WriteStream | null;
  writePromises: Array<Promise<void>>;
}

function ensureStream(core: LoggerCore): WriteStream {
  if (!core.stream) {
    const dir = path.join(core.logRoot, core.track, localISODate());
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${core.trace}.jsonl`);
    core.stream = createWriteStream(file, { flags: 'a' });
  }
  return core.stream;
}

class TrackLoggerImpl implements TrackLogger {
  readonly track: string;
  readonly trace: string;
  private readonly core: LoggerCore;
  private readonly scope: string | undefined;

  constructor(core: LoggerCore, scope: string | undefined) {
    this.core = core;
    this.track = core.track;
    this.trace = core.trace;
    this.scope = scope;
  }

  log(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
    const stream = ensureStream(this.core);
    const entry: LogEntry = {
      ts: Date.now(),
      level,
      track: this.track,
      trace: this.trace,
      ...(this.scope !== undefined ? { scope: this.scope } : {}),
      event,
      ...data,
    };
    const line = JSON.stringify(entry) + '\n';
    const p = new Promise<void>((resolve, reject) => {
      stream.write(line, (err) => (err ? reject(err) : resolve()));
    });
    this.core.writePromises.push(p);
  }

  child(scope: string): TrackLogger {
    validateScopeName(scope);
    const newScope = this.scope ? `${this.scope}.${scope}` : scope;
    return new TrackLoggerImpl(this.core, newScope);
  }

  async flush(): Promise<void> {
    const pending = this.core.writePromises.slice();
    this.core.writePromises = [];
    await Promise.all(pending);
  }
}

export function createTrackLogger(
  track: string,
  opts?: CreateTrackLoggerOptions,
): TrackLogger {
  const core: LoggerCore = {
    track,
    trace: generateUlid(),
    logRoot: opts?.logRoot ?? path.join(process.cwd(), '.zerou', 'logs'),
    stream: null,
    writePromises: [],
  };
  return new TrackLoggerImpl(core, undefined);
}
