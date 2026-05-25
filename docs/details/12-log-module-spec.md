# 12 — Log Module Spec (Track L)

> SPEC-SPLIT artifact, Phase 1. Sibling files:
> [public-surface](./12-log-module-public-surface.md) · [tests](./12-log-module-tests.md) · [comparison-report](./12-log-module-comparison-report.md)

---

## 1. Goal

Per-`track` × per-`trace` structured JSONL logger that every ZeroU component (hardener CLI, presets, critic, daemon) writes into and that tests can capture programmatically.

## 2. Non-goals

1. **No log shipping** — entries land on local disk only. No HTTP push, no syslog, no OpenTelemetry exporter. (Out-of-process consumers tail `.jsonl` files.)
2. **No log query API** — there is no built-in grep/filter/aggregation. `jq` on the files is the supported workflow.
3. **No request tracing across processes** — `trace` ID is per-process invocation. Cross-process propagation (passing trace from hardener CLI into a spawned subprocess) is deliberately deferred to Phase 3+; today the subprocess starts a fresh trace.
4. **No log level reconfiguration at runtime** — level is decided once at logger construction from `ZEROU_LOG_LEVEL`. Changing level mid-run requires restart.
5. **No PII redaction** — callers are responsible for not logging secrets. Logger writes whatever payload is given. (Q8 micro about key redaction is enforced at the CLI flag layer, not here.)
6. **No structured-log schema enforcement** — fields are arbitrary `Record<string, unknown>`. Each consumer module declares its events in its own Logging Contract (see §6 of each P2/P1/A spec); this module does not validate them.

## 3. Public surface

Authoritative shape lives in [12-log-module-public-surface.md](./12-log-module-public-surface.md). Summary:

```typescript
// core/log/track-logger.ts (Phase 3 target path)

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts:        number;                       // Unix ms
  level:     LogLevel;
  track:     string;
  trace:     string;                       // ULID
  scope?:    string;                       // present iff entry came from a child logger
  event:     string;                       // canonical dot-separated, e.g. "preset.load.success"
  [key: string]: unknown;                  // arbitrary structured payload
}

export interface TrackLogger {
  readonly track: string;
  readonly trace: string;
  log(level: LogLevel, event: string, data?: Record<string, unknown>): void;
  child(scope: string): TrackLogger;
  flush(): Promise<void>;
}

export interface CreateTrackLoggerOptions {
  /** Override the default `${cwd}/.zerou/logs` root. */
  logRoot?: string;
  /** Override the auto-generated ULID (for deterministic tests). */
  trace?: string;
  /** Override `ZEROU_LOG_LEVEL` env. */
  minLevel?: LogLevel;
  /** If true, no file writes occur (used by `ZEROU_LOG_NULL=1` and unit tests). */
  silent?: boolean;
}

export function createTrackLogger(track: string, opts?: CreateTrackLoggerOptions): TrackLogger;

// Test helper, separate file.
// core/log/test-helpers.ts

export interface CaptureOptions {
  /** Match only entries with this exact track. Default: any track. */
  track?: string;
  /** Match only entries with `event` matching this regex. Default: any event. */
  eventPattern?: RegExp;
}

export function captureLogsFor<T>(
  opts: CaptureOptions & { track: string },
  fn: () => Promise<T>,
): Promise<{ result: T; entries: LogEntry[] }>;
```

## 4. Internal design

### 4.1 File layout

```
<logRoot>/                                    # default <cwd>/.zerou/logs
└── <track>/
    └── <YYYY-MM-DD>/
        └── <trace>.jsonl                     # one JSON object per line
```

`<cwd>` is the process current directory at the time `createTrackLogger` is first called. Hardener CLI sets it to the audited repo path; tests typically point it at a tmpdir.

### 4.2 Write path

- Logger keeps a per-instance append-only `WriteStream`.
- `log()` is synchronous-API but asynchronous internally: it serializes the entry to a single `JSON.stringify(...) + '\n'` and `write()`s. No flush per entry.
- `flush()` returns a promise that resolves when all pending writes are durable.
- Process exit hook (`process.on('beforeExit')`) calls `flush()` on every live logger automatically.

### 4.3 Rotation

At construction time, the logger scans `<logRoot>/<track>/` for directories whose name parses as ISO date older than 7 days and `rm -rf`s them. Rotation runs at most once per process per track.

### 4.4 Level filtering

`minLevel` is resolved (constructor option > `ZEROU_LOG_LEVEL` env > `'info'`). Entries below `minLevel` are dropped before serialization. Ordering: `debug < info < warn < error`.

### 4.5 Child loggers

`child(scope)` returns a new `TrackLogger` that shares the parent's `WriteStream` and `trace`, but appends the scope to its own `scope` field. Multi-level scoping is supported (`logger.child('a').child('b')` produces `scope: 'a.b'`).

### 4.6 Test capture mechanics

`captureLogsFor` installs a process-level entry observer (no file IO needed when `silent: true` is set), runs `fn`, removes the observer, and returns the matching entries. Concurrent captures are supported via per-observer ID.

### 4.7 ULID generation

Uses a tiny inline ULID implementation (Crockford base32, 26 chars). No `ulid` npm dependency — the function is ~40 LOC and inlined to keep this module's runtime deps to zero (Node stdlib only).

## 5. Failure modes

| Code | Condition | Behavior |
|---|---|---|
| `LOG-E-1` | `<logRoot>` not writable (EACCES) | First `log()` call throws synchronously with message `LOG-E-1: log root <path> not writable`. Caller MAY catch and degrade. |
| `LOG-E-2` | Disk full (ENOSPC) on write | The entry is dropped; an `error`-level entry is emitted to `process.stderr` once per logger; subsequent writes are silently dropped until `flush()` is called and succeeds. |
| `LOG-E-3` | `track` string contains a path separator or starts with `.` | `createTrackLogger` throws synchronously: `LOG-E-3: invalid track name <name>`. |
| `LOG-E-4` | `event` string is empty | `log()` is a no-op and emits one `warn`-level meta-entry per offending caller: `event: 'log.invalid-event-name'`. |
| `LOG-E-5` | `data` payload contains a circular reference | `log()` writes the entry with the offending field replaced by `'[Circular]'`. Does not throw. |
| `LOG-E-6` | `ZEROU_LOG_NULL=1` or `silent: true` in opts | All writes become no-ops. `captureLogsFor` still observes entries via the in-process observer; nothing reaches disk. |
| `LOG-E-7` | Rotation cleanup fails on one date dir | Logged once as a meta-entry `event: 'log.rotation-failed'`; subsequent rotation attempts continue with remaining dirs. |

## 6. Logging Contract

This module logs about itself via meta-entries on the logger it returns.

### 6.1 Track name

For the logger module's own meta-events, the track is `log` (yes, the logger logs into `log` track when reporting its own internal events like rotation, capture-observer install/remove, error degradation).

### 6.2 Required events

| Event name | Level | When | Required fields |
|---|---|---|---|
| `log.rotation-complete` | `info` | Rotation finished (even if no dirs removed) | `track`, `removedDirs: string[]` |
| `log.rotation-failed` | `warn` | Rotation hit an error on one date dir (LOG-E-7) | `track`, `dateDir: string`, `error: string` |
| `log.write-degraded` | `error` | First ENOSPC encountered (LOG-E-2) | `track` |
| `log.invalid-event-name` | `warn` | `log()` called with empty event (LOG-E-4) | `caller: string` (best-effort stack frame) |
| `log.capture-observer-installed` | `debug` | `captureLogsFor` enters | `observerId: string`, `track`, `eventPattern: string \| null` |
| `log.capture-observer-removed` | `debug` | `captureLogsFor` exits (always, even on throw) | `observerId: string` |

### 6.3 Required child scopes

| Scope name | Used by | Internal events |
|---|---|---|
| `rotation` | The constructor's rotation pass | `rotation.scan-start`, `rotation.dir-removed`, `rotation.dir-failed`, `rotation.scan-end` |
| `capture` | `captureLogsFor` lifecycle | uses `log.capture-observer-*` events directly (no extra child events) |

### 6.4 Behavior ↔ Log event reverse lookup

This table is the canonical bridge between [[Behavior IDs]] in §7 and observable log events. Test doc (12-log-module-tests.md) MUST use this table for its assertions.

| Behavior ID | Log assertion |
|---|---|
| B-1-1 | After `createTrackLogger('foo')`, `<logRoot>/foo/<today>/<trace>.jsonl` exists |
| B-1-2 | After `log('info', 'x.y', {a: 1})`, the file contains a JSON line with `event: 'x.y'`, `level: 'info'`, `track: 'foo'`, `a: 1` |
| B-1-3 | `child('s')` returned logger writes `scope: 's'` |
| B-1-4 | Nested `child('a').child('b')` writes `scope: 'a.b'` |
| B-2-1 | After 7+ day-old dirs exist, constructor emits `log.rotation-complete` with non-empty `removedDirs` |
| B-2-2 | If a date dir cannot be removed, constructor emits `log.rotation-failed` and continues with remaining dirs |
| B-3-1 | `ZEROU_LOG_LEVEL=warn` then `log('info', ...)` produces zero file entries |
| B-3-2 | `silent: true` opts produces zero file entries but `captureLogsFor` still observes |
| B-4-1 | `captureLogsFor({track:'foo'}, fn)` returns only `track === 'foo'` entries |
| B-4-2 | Concurrent `captureLogsFor` runs do not see each other's entries |
| B-4-3 | `captureLogsFor` always emits `log.capture-observer-removed` even when `fn` throws |
| B-5-1 | `log('info', '', {})` produces a `log.invalid-event-name` warn entry and no `info` entry |
| B-5-2 | Circular data field is serialized as `'[Circular]'` |
| B-6-1 | `flush()` resolves only after all pending writes are durable on disk |
| B-6-2 | `process.on('beforeExit')` triggers `flush()` on every live logger |

## 7. Behaviors

Each Behavior ID is the unit a test case targets. Test doc enumerates one happy + one negative test per ID minimum.

### B-1 — Construction & write path

- **B-1-1** Constructing a logger creates the date-partitioned JSONL file at the first `log()` call.
- **B-1-2** A logged entry serializes as one JSON object on one line containing `ts, level, track, trace, event` plus arbitrary payload keys.
- **B-1-3** `child(scope)` entries carry the `scope` field.
- **B-1-4** Nested `child().child()` produces dot-joined `scope`.

### B-2 — Rotation

- **B-2-1** Date directories older than 7 days are removed at constructor time.
- **B-2-2** Failure to remove one date dir is logged as `log.rotation-failed`; rotation continues with remaining dirs.

### B-3 — Level filtering & silent mode

- **B-3-1** `ZEROU_LOG_LEVEL=warn` filters out lower-level entries before serialization.
- **B-3-2** `silent: true` (or `ZEROU_LOG_NULL=1`) produces no file writes; `captureLogsFor` still observes.

### B-4 — Test capture

- **B-4-1** `captureLogsFor` with a `track` filter only yields entries from that track.
- **B-4-2** Concurrent captures are isolated.
- **B-4-3** Observer is always removed on exit, even when `fn` throws.

### B-5 — Defensive serialization

- **B-5-1** Empty `event` is rejected with a `log.invalid-event-name` warn meta-entry; no file write for the invalid call.
- **B-5-2** Circular references in `data` are replaced with `'[Circular]'` instead of throwing.

### B-6 — Durability

- **B-6-1** `flush()` resolves only after all pending writes are fsynced.
- **B-6-2** Process exit hook calls `flush()` on all live loggers.

## 8. Dependencies

This module has zero internal dependencies — it is the foundation that other tracks (P2, P1, A) import. External dependencies: Node stdlib only (`fs`, `path`, `process`). No npm packages.

Other tracks depend on it via:

- P2 (Preset Framework) — every preset loader / runner call accepts an optional `logger: TrackLogger` parameter; if omitted, the module creates one under `track='preset'`.
- P1 (Cross-Engine Reviewer) — same pattern, default `track='critic'`.
- A (Hardener CLI) — top-level `zerou audit` creates one logger under `track='cli'` and child-scopes for major phases (`cli.scan`, `cli.verdict`, `cli.bundle`, `cli.apply`).
