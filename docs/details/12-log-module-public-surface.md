# 12 — Log Module Public Surface

> Black-box contract for the log module. **Test doc authors MUST read only this file**, not the spec.

---

## Importable symbols

```typescript
// from "core/log/track-logger"

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogErrorCode = 'LOG-E-1' | 'LOG-E-2' | 'LOG-E-3' | 'LOG-E-4' | 'LOG-E-5';

export class LogError extends Error {
  readonly code: LogErrorCode;
  constructor(code: LogErrorCode, message: string);
}

export interface LogEntry {
  ts:        number;        // Unix milliseconds, integer
  level:     LogLevel;
  track:     string;
  trace:     string;        // 26-character ULID (Crockford base32)
  scope?:    string;        // present iff entry came from a child logger
  event:     string;        // dot-separated canonical name, non-empty
  [key: string]: unknown;   // arbitrary structured payload, callers' responsibility
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
  trace?:   string;
  minLevel?: LogLevel;
  silent?:  boolean;
  parentTrace?: string;   // optional 26-char ULID; when supplied, the new logger uses this as its `trace` instead of generating a fresh ULID.
}

export function createTrackLogger(
  track: string,
  opts?: CreateTrackLoggerOptions,
): TrackLogger;
```

```typescript
// from "core/log/test-helpers"

export interface CaptureOptions {
  track?: string;
  eventPattern?: RegExp;
}

export function captureLogsFor<T>(
  opts: CaptureOptions & { track: string },
  fn: () => Promise<T>,
): Promise<{ result: T; entries: LogEntry[] }>;
```

## Surface version

```typescript
export const LOG_SURFACE_VERSION = '1.0' as const;
```

## Environment variables consumed

| Var | Type | Effect |
|---|---|---|
| `ZEROU_LOG_LEVEL` | `'debug' \| 'info' \| 'warn' \| 'error'` | Floor for which entries are serialized. Overridden by `CreateTrackLoggerOptions.minLevel`. |
| `ZEROU_LOG_NULL` | `'1'` | Disables file writes globally; equivalent to `silent: true` on every logger. `captureLogsFor` still observes. Rotation is also skipped (see "Rotation guarantee"). |

## On-disk format

When a logger is constructed with no `silent: true` and writes its first entry, it creates:

```
<logRoot>/<track>/<YYYY-MM-DD>/<trace>.jsonl
```

Where `<YYYY-MM-DD>` is the **local-time** ISO calendar date at construction time (not UTC, not ISO 8601 datetime — just the calendar date in the operator's local timezone). Rationale: matches the operator's mental model when grepping `ls .zerou/logs/<track>/`. DST behavior: a logger constructed at 2026-03-08 02:30 local during a DST forward shift uses date string `2026-03-08`.

Each entry in the file is exactly one line, terminated by `\n`, parseable by `JSON.parse`, and conforms to `LogEntry`.

Default `<logRoot>` is `${process.cwd()}/.zerou/logs` when `CreateTrackLoggerOptions.logRoot` is omitted.

## Rotation guarantee

When a logger is constructed (and `silent: true` is **not** set and `ZEROU_LOG_NULL=1` is **not** set), the module scans `<logRoot>/<track>/` for date-named subdirectories whose ISO date is **strictly more than 7 days before today** (local-time `YYYY-MM-DD`). Those directories are removed. Directories whose date is **≤7 days before today** (inclusive) are kept.

Concrete example: today `2026-05-25`, kept range `[2026-05-18, 2026-05-25]` (8 days inclusive); `2026-05-17` and older are removed.

Rotation runs at most once per **(Node process, track)** pair, tracked via a module-level Set. Each vitest worker thread is its own Node process and runs rotation independently.

**`silent: true` and `ZEROU_LOG_NULL=1` skip rotation entirely** — no directory scanning, no removal. Silent loggers touch no filesystem.

## Child logger semantics

`logger.child(scope)` returns a `TrackLogger` whose:

- `track` equals the parent's `track`. **This is load-bearing for cross-module wiring**: `child(scope)` NEVER changes `track`. Downstream modules that need to log under their own `track` while sharing the caller's `trace` MUST use `createTrackLogger(theirTrack, { parentTrace: caller.trace })` (see `parentTrace` below), not `caller.child(...)`.
- `trace` equals the parent's `trace`.
- Every entry it writes carries a `scope` field equal to:
  - the supplied `scope` string if called on a root logger,
  - the parent's `scope` joined with `.` and the supplied string if called on an already-scoped logger.

Calling `child('')` (empty string) throws a `LogError` with `code: 'LOG-E-3'` synchronously — scope name validation is parallel to track name validation.

### `parentTrace` (cross-module trace inheritance)

`CreateTrackLoggerOptions.parentTrace` is an optional 26-char ULID. When supplied:

- The new logger's `trace` is set to `parentTrace` verbatim (no fresh ULID is generated, and `CreateTrackLoggerOptions.trace`, if also supplied, is overridden by `parentTrace`).
- The new logger's `track` is still the `track` argument to `createTrackLogger(...)` — `parentTrace` only inherits `trace`, never `track`.

**This allows downstream modules to share the caller's `trace_id` while keeping their own `track_id`.** Example: a CLI logger `createTrackLogger('cli')` generates trace `T1`; the CLI hands its logger to Protocol-1, which internally constructs `createTrackLogger('critic', { parentTrace: cliLogger.trace })` so all `critic.*` events under `track: 'critic'` carry the same `trace: T1` as the CLI's `cli.*` events. Both tracks can be filtered independently while still reconstructable into a single causal chain by `trace`.

When `parentTrace` is omitted, the logger generates a fresh ULID (the existing default behavior).

## Error codes

`createTrackLogger`, `child`, and `log` may throw a `LogError` (subclass of `Error`) with `error.code` equal to the code below and `error.message` starting with the same code.

| Code | Trigger |
|---|---|
| `LOG-E-1` | `<logRoot>` is not writable (EACCES) — thrown on first write attempt. |
| `LOG-E-2` | Disk full (ENOSPC) — the offending entry is dropped, one stderr warning is emitted per logger, subsequent writes are dropped until `flush()` succeeds (at which point normal writes resume). Does not throw. |
| `LOG-E-3` | `track` contains a path separator (`/`, `\`) or starts with `.`, **OR** `child(scope)` is called with an empty string or a `scope` containing a path separator — thrown synchronously from `createTrackLogger` / `child`. |
| `LOG-E-4` | `event` argument is empty string — `log()` does not throw; emits one `log.invalid-event-name` warn meta-entry and skips the write. |
| `LOG-E-5` | `data` contains a circular reference — any field that is part of a cycle (at any depth) is serialized as the string `'[Circular]'`; non-cyclic fields at any depth serialize normally; the entry is still written; no throw. Implementation hint: `WeakSet` + custom JSON replacer. |

## Behavior contract

The module guarantees the following observable behaviors. Test cases assert these directly.

### B-1 — Construction & write path

- **B-1-1** After `createTrackLogger('foo', { logRoot: tmp })`, calling `.log('info', 'x', {})` causes the file `<tmp>/foo/<today>/<trace>.jsonl` to exist with one JSON line.
- **B-1-2** The written entry is parseable JSON containing `ts: number`, `level: 'info'`, `track: 'foo'`, `trace: <26-char ULID>`, `event: 'x'`, plus any caller-supplied keys.
- **B-1-3** A logger produced by `root.child('s')` writes entries with `scope: 's'`.
- **B-1-4** `root.child('a').child('b')` writes entries with `scope: 'a.b'`.

### B-2 — Rotation

- **B-2-1** If a date directory **strictly more than 7 days before today** exists under `<logRoot>/<track>/` before construction, it is removed during construction. Directories ≤7 days old are kept.
- **B-2-2** If removal of one date directory fails, construction does not throw and rotation proceeds with remaining directories.

### B-3 — Level filtering & silent mode

- **B-3-1** With `minLevel: 'warn'` (or `ZEROU_LOG_LEVEL=warn`), a call `.log('info', 'x', {})` produces zero on-disk entries.
- **B-3-2** With `silent: true` (or `ZEROU_LOG_NULL=1`), no file is created, no entry is written, and no rotation scan runs, BUT `captureLogsFor` still observes the call.

### B-4 — Test capture

- **B-4-1** `captureLogsFor({ track: 'foo' }, fn)` returns `{ result, entries }` where `entries` is only the entries written with `track === 'foo'` during `fn`'s execution.
- **B-4-2** Two `captureLogsFor` calls running concurrently (overlapping in time) each see only their own track's entries, never the other's.
- **B-4-3** When `fn` throws, `captureLogsFor` re-throws and still cleans up its observer; a subsequent `captureLogsFor` on a different track does not see leaked observers.
- **B-4-4** Concurrent and nested `captureLogsFor` calls each receive every entry written during their `fn`'s execution that matches their filters. Observers do not consume entries — multiple observers can see the same entry. The same entry is also written to disk (unless `silent: true`).
- **B-4-5** `entries` is ordered chronologically: FIFO by `.log()` call time on the calling thread. (Cross-thread ordering — should Node ever gain worker `log()` calls — is not promised; see "What this surface does NOT promise".)
- **B-4-6** Meta-events emitted by the log module are always written under `track: 'log'`. They never appear in another track's captures: `captureLogsFor({ track: 'foo' }, …)` will not return any `log.*` events.

### B-5 — Defensive serialization

- **B-5-1** `.log('info', '', {})` writes no `info` entry; it writes one `log.invalid-event-name` `warn` entry with field `caller: string` (best-effort).
- **B-5-2** `.log('info', 'x', { circ: <circular> })` writes one entry where the `circ` field (and any deeply nested field that is part of a cycle) is the string `'[Circular]'`; no exception is thrown.

### B-6 — Durability

- **B-6-1** `await flush()` resolves only after every entry logged before the call is fsynced to disk (reading the file at that point yields all entries).
- **B-6-2** Triggering `process.beforeExit` (via `process.emit('beforeExit', 0)` in tests) causes every live logger's pending writes to flush. On completion, the module emits one `log.beforeexit-flushed` meta-event (see "Self-emitted meta-events") with `flushedCount: number` and `durationMs: number`.

### B-7 — `LOG-E-1` (logRoot not writable)

- **B-7-1** When `<logRoot>` is not writable (EACCES) and the logger is not `silent`, the **first write attempt** (`.log(...)`) throws a `LogError` with `code: 'LOG-E-1'`. Construction itself does not throw (errors are deferred to first I/O). Subsequent write attempts also throw `LOG-E-1`.

### B-8 — `LOG-E-2` (disk full degraded mode)

- **B-8-1** When `.log(...)` encounters ENOSPC on write:
  1. The offending entry is **dropped** (no file write, no throw).
  2. One stderr warning is emitted **per logger instance** (subsequent ENOSPC drops on the same logger do not re-warn).
  3. A `log.write-degraded` meta-event is emitted under `track: 'log'` with `track: <degraded-track>` payload.
  4. Subsequent `.log(...)` calls on the same logger are dropped (no I/O attempt) until the next `flush()` call **succeeds** without ENOSPC.
  5. Once `flush()` succeeds, normal write behavior resumes on the next `.log(...)` call.

These side effects are observable via `captureLogsFor({ track: 'log' }, ...)` (the `log.write-degraded` event) and via reading the on-disk file (the dropped entries are absent).

## Self-emitted meta-events

Even when no caller logs anything, this module may emit the following events under `track: 'log'`. These meta-events **never** leak into application-track captures (see B-4-6).

| Event | Level | When | Required payload |
|---|---|---|---|
| `log.rotation-complete` | `info` | After rotation pass at construction | `track: string`, `removedDirs: string[] (absolute paths)` |
| `log.rotation-failed` | `warn` | A date dir removal failed | `track: string`, `dateDir: string (absolute path)`, `error: string` |
| `log.write-degraded` | `error` | First ENOSPC encountered on a logger | `track: string` |
| `log.invalid-event-name` | `warn` | A caller passed empty `event` | `caller: string` (best-effort — see "What this surface does NOT promise") |
| `log.capture-observer-installed` | `debug` | `captureLogsFor` enters | `observerId: string`, `track: string`, `eventPattern: string \| null` |
| `log.capture-observer-removed` | `debug` | `captureLogsFor` exits | `observerId: string` |
| `log.beforeexit-flushed` | `info` | `process.beforeExit` flush completed | `flushedCount: number`, `durationMs: number` |

## What this surface does NOT promise

- It does not promise file paths beyond the layout above (no claim about file modes, ownership, or platform-specific behavior).
- It does not promise serialization order across concurrent `log()` calls on different loggers — only that each call's entry is atomically one line. `captureLogsFor` chronological order (B-4-5) is **single-thread** FIFO; cross-thread or cross-worker ordering is not promised.
- It does not promise rotation correctness against system-clock changes mid-process.
- It does not promise behavior under symlinked `<logRoot>` (treated as caller's responsibility).
- It does not promise a strong contract on the `caller: string` field of `log.invalid-event-name` meta-entries. This is **intentionally loose** ("best-effort"): the implementation may use `Error().stack` parsing and the frame format varies by Node version. Tests should assert only `typeof caller === 'string' && caller.length > 0`.
