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
    // Level filter (B-3-1)
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.core.minLevel]) return;
    // Silent mode (B-3-2): no disk write
    if (this.core.silent) return;

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
