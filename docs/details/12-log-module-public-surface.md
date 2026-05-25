# 12 — Log Module Public Surface

> Black-box contract for the log module. **Test doc authors MUST read only this file**, not the spec.

---

## Importable symbols

```typescript
// from "core/log/track-logger"

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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
| `ZEROU_LOG_NULL` | `'1'` | Disables file writes globally; equivalent to `silent: true` on every logger. `captureLogsFor` still observes. |

## On-disk format

When a logger is constructed with no `silent: true` and writes its first entry, it creates:

```
<logRoot>/<track>/<YYYY-MM-DD>/<trace>.jsonl
```

Where `<YYYY-MM-DD>` is the local date at construction time.

Each entry in the file is exactly one line, terminated by `\n`, parseable by `JSON.parse`, and conforms to `LogEntry`.

Default `<logRoot>` is `${process.cwd()}/.zerou/logs` when `CreateTrackLoggerOptions.logRoot` is omitted.

## Rotation guarantee

When a logger is constructed, the module scans `<logRoot>/<track>/` for date-named subdirectories whose ISO date is more than 7 days before today. Those directories are removed. Rotation runs at most once per (process, track) pair.

## Child logger semantics

`logger.child(scope)` returns a `TrackLogger` whose:

- `track` equals the parent's `track`.
- `trace` equals the parent's `trace`.
- Every entry it writes carries a `scope` field equal to:
  - the supplied `scope` string if called on a root logger,
  - the parent's `scope` joined with `.` and the supplied string if called on an already-scoped logger.

## Error codes

Errors throw synchronously from `createTrackLogger` and `log` with `error.message` starting with the code:

| Code | Trigger |
|---|---|
| `LOG-E-1` | `<logRoot>` is not writable (EACCES) — thrown on first write attempt. |
| `LOG-E-2` | Disk full (ENOSPC) — written entry is dropped, one stderr warning per logger, subsequent writes dropped until `flush()` succeeds. Does not throw. |
| `LOG-E-3` | `track` contains a path separator (`/`, `\`) or starts with `.` — thrown synchronously from `createTrackLogger`. |
| `LOG-E-4` | `event` argument is empty string — `log()` does not throw; emits one `log.invalid-event-name` warn meta-entry and skips the write. |
| `LOG-E-5` | `data` contains a circular reference — the offending field is replaced with the string `'[Circular]'`; entry is still written; no throw. |

## Behavior contract

The module guarantees the following observable behaviors. Test cases assert these directly.

### B-1 — Construction & write path

- **B-1-1** After `createTrackLogger('foo', { logRoot: tmp })`, calling `.log('info', 'x', {})` causes the file `<tmp>/foo/<today>/<trace>.jsonl` to exist with one JSON line.
- **B-1-2** The written entry is parseable JSON containing `ts: number`, `level: 'info'`, `track: 'foo'`, `trace: <26-char ULID>`, `event: 'x'`, plus any caller-supplied keys.
- **B-1-3** A logger produced by `root.child('s')` writes entries with `scope: 's'`.
- **B-1-4** `root.child('a').child('b')` writes entries with `scope: 'a.b'`.

### B-2 — Rotation

- **B-2-1** If a date directory older than 7 days exists under `<logRoot>/<track>/` before construction, it is removed during construction.
- **B-2-2** If removal of one date directory fails, construction does not throw and rotation proceeds with remaining directories.

### B-3 — Level filtering & silent mode

- **B-3-1** With `minLevel: 'warn'` (or `ZEROU_LOG_LEVEL=warn`), a call `.log('info', 'x', {})` produces zero on-disk entries.
- **B-3-2** With `silent: true` (or `ZEROU_LOG_NULL=1`), no file is created and no entry is written, BUT `captureLogsFor` still observes the call.

### B-4 — Test capture

- **B-4-1** `captureLogsFor({ track: 'foo' }, fn)` returns `{ result, entries }` where `entries` is only the entries written with `track === 'foo'` during `fn`'s execution.
- **B-4-2** Two `captureLogsFor` calls running concurrently (overlapping in time) each see only their own track's entries, never the other's.
- **B-4-3** When `fn` throws, `captureLogsFor` re-throws and still cleans up its observer; a subsequent `captureLogsFor` on a different track does not see leaked observers.

### B-5 — Defensive serialization

- **B-5-1** `.log('info', '', {})` writes no `info` entry; it writes one `log.invalid-event-name` `warn` entry with field `caller: string` (best-effort).
- **B-5-2** `.log('info', 'x', { circ: <circular> })` writes one entry where the `circ` field is the string `'[Circular]'`; no exception is thrown.

### B-6 — Durability

- **B-6-1** `await flush()` resolves only after every entry logged before the call is fsynced to disk (reading the file at that point yields all entries).
- **B-6-2** Triggering `process.beforeExit` (via `process.emit('beforeExit', 0)` in tests) causes every live logger's pending writes to flush.

## Self-emitted meta-events

Even when no caller logs anything, this module may emit the following events under `track: 'log'`:

| Event | Level | When | Required payload |
|---|---|---|---|
| `log.rotation-complete` | `info` | After rotation pass at construction | `track: string`, `removedDirs: string[]` |
| `log.rotation-failed` | `warn` | A date dir removal failed | `track: string`, `dateDir: string`, `error: string` |
| `log.write-degraded` | `error` | First ENOSPC encountered | `track: string` |
| `log.invalid-event-name` | `warn` | A caller passed empty `event` | `caller: string` |
| `log.capture-observer-installed` | `debug` | `captureLogsFor` enters | `observerId: string`, `track: string`, `eventPattern: string \| null` |
| `log.capture-observer-removed` | `debug` | `captureLogsFor` exits | `observerId: string` |

## What this surface does NOT promise

- It does not promise file paths beyond the layout above (no claim about file modes, ownership, or platform-specific behavior).
- It does not promise serialization order across concurrent `log()` calls on different loggers — only that each call's entry is atomically one line.
- It does not promise rotation correctness against system-clock changes mid-process.
- It does not promise behavior under symlinked `<logRoot>` (treated as caller's responsibility).
