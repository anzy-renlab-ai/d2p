/**
 * ZeroU log module — per-track × per-trace structured JSONL logger.
 *
 * Surface authority: `docs/details/12-log-module-public-surface.md` @ commit 5eee600.
 * Phase 2 implementation lives at `daemon/src/log/`. Phase 3 target path is
 * `core/log/`.
 *
 * This file grows incrementally via TDD red-green per behavior B-1-1 → B-8-1.
 */

import * as fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

type WriteStream = fs.WriteStream;

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
  trace?: string;
  minLevel?: LogLevel;
  silent?: boolean;
  parentTrace?: string;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function resolveMinLevel(opts: CreateTrackLoggerOptions): LogLevel {
  const fromOpts = opts.minLevel;
  if (fromOpts) return fromOpts;
  const fromEnv = process.env.ZEROU_LOG_LEVEL as LogLevel | undefined;
  if (fromEnv && fromEnv in LEVEL_ORDER) return fromEnv;
  return 'info';
}

function isSilentMode(opts: CreateTrackLoggerOptions): boolean {
  if (opts.silent === true) return true;
  if (process.env.ZEROU_LOG_NULL === '1') return true;
  return false;
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

// ── Rotation: remove date dirs strictly more than 7 days before today ───────
//
// Per surface §"Rotation guarantee": cutoff is strict (>7 days removed; ≤7 kept),
// per (Node process, track) idempotent via module-level Set, skipped when
// silent / ZEROU_LOG_NULL=1.

const DATE_DIR_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const rotatedPerProcess = new Set<string>();

interface RotationResult {
  removed: string[];          // absolute paths
  failed: Array<{ dateDir: string; error: string }>;
}

function rotateOldDateDirs(logRoot: string, track: string): RotationResult {
  const key = `${process.pid}|${track}|${logRoot}`;
  if (rotatedPerProcess.has(key)) return { removed: [], failed: [] };
  rotatedPerProcess.add(key);

  const trackDir = path.join(logRoot, track);
  let entries: string[];
  try {
    entries = fs.readdirSync(trackDir);
  } catch {
    // track dir doesn't exist yet — nothing to rotate.
    return { removed: [], failed: [] };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 7);

  const result: RotationResult = { removed: [], failed: [] };
  for (const name of entries) {
    const match = DATE_DIR_RE.exec(name);
    if (!match) continue;
    const dirDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (dirDate >= cutoff) continue; // strictly older than 7 days → remove
    const abs = path.join(trackDir, name);
    try {
      _rmDateDirForRotation(abs);
      result.removed.push(abs);
    } catch (err) {
      result.failed.push({ dateDir: abs, error: (err as Error).message });
    }
  }
  return result;
}

// Test-only escape hatch: clear the rotation-once-per-process gate so tests
// that share a Node process can each exercise rotation independently.
export function __resetRotationGateForTests(): void {
  rotatedPerProcess.clear();
}

// ── Observer registry (used by captureLogsFor) ───────────────────────────────
//
// Observers receive every entry written by any logger in this process after
// level filtering, regardless of silent mode (surface B-3-2 promises silent
// loggers still observed). Multiple observers can match the same entry; they
// do not consume (surface B-4-4). Filters: track (exact match) + optional
// eventPattern (regex).

export interface LogObserver {
  readonly id: string;
  readonly track: string;
  readonly eventPattern?: RegExp;
  readonly entries: LogEntry[];
}

const observers = new Map<string, LogObserver>();

export function __addLogObserver(opts: { track: string; eventPattern?: RegExp }): LogObserver {
  const obs: LogObserver = {
    id: generateUlid(),
    track: opts.track,
    eventPattern: opts.eventPattern,
    entries: [],
  };
  observers.set(obs.id, obs);
  return obs;
}

export function __removeLogObserver(id: string): void {
  observers.delete(id);
}

function notifyObservers(entry: LogEntry): void {
  for (const obs of observers.values()) {
    if (entry.track !== obs.track) continue;
    if (obs.eventPattern && !obs.eventPattern.test(entry.event)) continue;
    obs.entries.push(entry);
  }
}

// ── Meta-event emission (always under track='log') ──────────────────────────
//
// Meta-events (rotation-complete, invalid-event-name, write-degraded, etc.)
// share a process-wide trace and only flow through notifyObservers — they are
// NOT written to disk in this Phase-2 implementation. Disk persistence for
// meta events can be added later by lazily constructing a real TrackLogger
// for track='log' (deferred).

const META_TRACE = generateUlid();

function emitMetaEvent(
  level: LogLevel,
  event: string,
  data: Record<string, unknown> = {},
): void {
  const entry: LogEntry = {
    ts: Date.now(),
    level,
    track: 'log',
    trace: META_TRACE,
    event,
    ...data,
  };
  notifyObservers(entry);
}

// ── Safe JSON stringify (deep cycle → '[Circular]') — LOG-E-5 ───────────────

function safeStringify(obj: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(obj, function (_key, value) {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value as object)) return '[Circular]';
      seen.add(value as object);
    }
    return value;
  });
}

// ── Best-effort caller-frame extraction for log.invalid-event-name ──────────

function bestEffortCaller(): string {
  const stack = new Error().stack ?? '';
  // Skip "Error", current frame, and emitMetaEvent / log frames; pick first
  // frame outside this module.
  const lines = stack.split('\n').slice(1);
  for (const line of lines) {
    if (line.includes('track-logger.')) continue;
    return line.trim();
  }
  return '(unknown)';
}

// Test-only seam: vi.spyOn cannot redefine ESM namespace properties, so the
// rotation's rm operation goes through an injectable function. Tests use
// __setRotationRmForTests(fn) to substitute synthetic failures; default is
// fs.rmSync.
let _rmDateDirForRotation: (abs: string) => void = (abs) =>
  fs.rmSync(abs, { recursive: true, force: true });
export function __setRotationRmForTests(fn: ((abs: string) => void) | null): void {
  _rmDateDirForRotation = fn ?? ((abs) => fs.rmSync(abs, { recursive: true, force: true }));
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
  minLevel: LogLevel;
  silent: boolean;
}

function ensureStream(core: LoggerCore): WriteStream {
  if (!core.stream) {
    const dir = path.join(core.logRoot, core.track, localISODate());
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${core.trace}.jsonl`);
    core.stream = fs.createWriteStream(file, { flags: 'a' });
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
    // Empty event name → drop + emit meta-event (LOG-E-4 / B-5-1).
    if (event === '') {
      emitMetaEvent('warn', 'log.invalid-event-name', { caller: bestEffortCaller() });
      return;
    }

    // Level filter (B-3-1)
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.core.minLevel]) return;

    const entry: LogEntry = {
      ts: Date.now(),
      level,
      track: this.track,
      trace: this.trace,
      ...(this.scope !== undefined ? { scope: this.scope } : {}),
      event,
      ...data,
    };

    // Observers see every entry past the level filter, even under silent mode
    // (B-3-2 promises silent loggers still observed). Multiple observers are
    // non-consuming (B-4-4).
    notifyObservers(entry);

    // Silent mode (B-3-2): no disk write past this point
    if (this.core.silent) return;

    const stream = ensureStream(this.core);
    const line = safeStringify(entry) + '\n';
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
  const o = opts ?? {};
  const logRoot = o.logRoot ?? path.join(process.cwd(), '.zerou', 'logs');
  const silent = isSilentMode(o);
  // Silent loggers skip rotation entirely (touch no filesystem) — B-3-2.
  if (!silent) rotateOldDateDirs(logRoot, track);
  const core: LoggerCore = {
    track,
    trace: o.parentTrace ?? o.trace ?? generateUlid(),
    logRoot,
    stream: null,
    writePromises: [],
    minLevel: resolveMinLevel(o),
    silent,
  };
  return new TrackLoggerImpl(core, undefined);
}
