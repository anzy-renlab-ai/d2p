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
  flush(): Promise<void>;
}

export interface CreateTrackLoggerOptions {
  logRoot?: string;
}

// ── ULID (Crockford base32, 26 chars) ────────────────────────────────────────
//
// Inlined to keep this module's runtime deps at Node stdlib only (per spec §4.7).
// Time component (10 chars) encodes Unix ms; random component (16 chars) is
// generated from Math.random() — sufficient for ZeroU's audit trace IDs which
// are not cryptographic. Phase 3 may swap to crypto.randomBytes if needed.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateUlid(): string {
  const ms = Date.now();
  let timePart = '';
  let t = ms;
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[t % 32]! + timePart;
    t = Math.floor(t / 32);
  }
  let randPart = '';
  for (let i = 0; i < 16; i++) {
    randPart += CROCKFORD[Math.floor(Math.random() * 32)]!;
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

class TrackLoggerImpl implements TrackLogger {
  readonly track: string;
  readonly trace: string;
  private stream: WriteStream | null = null;
  private writePromises: Array<Promise<void>> = [];
  private readonly logRoot: string;

  constructor(track: string, opts: CreateTrackLoggerOptions = {}) {
    this.track = track;
    this.trace = generateUlid();
    this.logRoot = opts.logRoot ?? path.join(process.cwd(), '.zerou', 'logs');
  }

  log(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
    if (!this.stream) {
      const dir = path.join(this.logRoot, this.track, localISODate());
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${this.trace}.jsonl`);
      this.stream = createWriteStream(file, { flags: 'a' });
    }
    const entry: LogEntry = {
      ts: Date.now(),
      level,
      track: this.track,
      trace: this.trace,
      event,
      ...data,
    };
    const line = JSON.stringify(entry) + '\n';
    const p = new Promise<void>((resolve, reject) => {
      this.stream!.write(line, (err) => (err ? reject(err) : resolve()));
    });
    this.writePromises.push(p);
  }

  async flush(): Promise<void> {
    const pending = this.writePromises.slice();
    this.writePromises = [];
    await Promise.all(pending);
  }
}

export function createTrackLogger(
  track: string,
  opts?: CreateTrackLoggerOptions,
): TrackLogger {
  return new TrackLoggerImpl(track, opts);
}
