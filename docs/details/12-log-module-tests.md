# 12 — Log Module Test Plan

> Black-box test plan derived **solely** from `12-log-module-public-surface.md` and `CONTEXT.md`. The test author did not read the spec or source.

---

## Section 1 — Test framework assumption

- Framework: **`vitest`** (ZeroU project standard, declared in `CLAUDE.md`).
- Runtime: **Node.js** (Node 24 per project tech stack). `fs/promises` and `node:fs` are assumed available without polyfill.
- ESM-style imports (`import { createTrackLogger } from "core/log/track-logger"`).
- All assertions use vitest's built-in `expect` matchers.
- Time mocking uses `vi.useFakeTimers()` / `vi.setSystemTime()`.
- Concurrency tests rely on real `Promise.all` plus structured ordering; no extra worker threads.

---

## Section 2 — Test environment helpers

These helpers are **described, not implemented**. The implementation lives in `core/log/test-helpers` (`captureLogsFor`) or in the test suite's local `__support__` directory.

### `tmpdir()` — isolated directory per test

- Creates a fresh directory under the OS temp root (e.g. `os.tmpdir() + '/zerou-log-' + ulid()`).
- Returns the absolute path.
- Registers an `afterEach` cleanup that recursively removes the directory.
- Each test that constructs a logger MUST use a unique `tmpdir()` result for `logRoot` so concurrent tests do not collide.

### `expectJsonlLine(path, n, partial)` — nth-line shape assertion

- Reads `path` synchronously.
- Splits by `\n`, drops trailing empty element.
- Asserts there are at least `n + 1` lines (0-indexed).
- `JSON.parse`s line `n`.
- Asserts the parsed object **matches** `partial` (deep partial: every key in `partial` must be present and equal, extra keys in the parsed line are allowed).
- Returns the parsed object so the test can make further assertions.

### `expectJsonlLineCount(path, n)` — line-count assertion

- Reads `path`; if missing, treats line count as `0`.
- Asserts the file contains exactly `n` JSONL-terminated lines.

### `withFakeTimers(now, fn)` — fixed-time helper

- Calls `vi.useFakeTimers()` then `vi.setSystemTime(now)` (where `now` may be a `Date` or ms number).
- Awaits `fn()`.
- Restores real timers in `finally`.

### `seedOldDateDir(logRoot, track, daysAgo)` — rotation fixture

- Computes the ISO date string `daysAgo` days before "today" (test-time clock).
- `mkdirSync` the path `<logRoot>/<track>/<that-date>/`.
- Optionally drops an empty `<that-date>/seed.jsonl` so the directory has content.
- Returns the absolute path of the created date directory.

### `injectCircular(obj, key)` — circular-reference fixture

- Sets `obj[key] = obj` and returns `obj`.
- Used to drive B-5-2.

### `captureLogsFor` (re-exported from `core/log/test-helpers`)

- Surface-defined helper. Tests import it directly; no wrapping needed.
- Used to assert on self-emitted meta-events under `track: 'log'`.

---

## Section 3 — Test cases

> For each `B-X-Y` behavior in the public surface, at least one happy-path and one negative/edge-case test. Test IDs follow the form `T-X-Y-Z`.

---

### T-1-1-1 (covers B-1-1)

**Name**: `createTrackLogger + .log writes a single JSONL line at <logRoot>/<track>/<today>/<trace>.jsonl`

**Setup**:
- `tmp = tmpdir()`.
- `vi.useFakeTimers(); vi.setSystemTime(new Date('2026-05-25T10:00:00Z'))`.
- `logger = createTrackLogger('foo', { logRoot: tmp })`.

**Action**:
- `logger.log('info', 'x', {})` then `await logger.flush()`.

**Assertion (return value or thrown error)**:
- `.log` returns `undefined` synchronously.
- File `<tmp>/foo/2026-05-25/<logger.trace>.jsonl` exists.
- File contains exactly 1 JSONL line.

**Assertion (log)**:
- `captureLogsFor({ track: 'log' }, async () => createTrackLogger('foo', { logRoot: tmp }))` observes one `log.rotation-complete` entry (proves construction-time meta-event path runs).

---

### T-1-1-2 (covers B-1-1)

**Name**: `createTrackLogger throws LOG-E-3 when track contains a path separator`

**Setup**:
- `tmp = tmpdir()`.

**Action**:
- `() => createTrackLogger('foo/bar', { logRoot: tmp })`.

**Assertion (return value or thrown error)**:
- Throws synchronously.
- `error.message` starts with `'LOG-E-3'`.
- No directory created under `tmp`.

**Assertion (log)**:
- (none — error path before any logger lives)

---

### T-1-2-1 (covers B-1-2)

**Name**: `entry has ts:number, level, track, trace (26-char ULID), event, plus caller keys`

**Setup**:
- `tmp = tmpdir()`.
- `logger = createTrackLogger('hardener', { logRoot: tmp })`.

**Action**:
- `logger.log('info', 'audit.start', { repo: '/tmp/r', cwd: process.cwd() })` then `await logger.flush()`.

**Assertion (return value or thrown error)**:
- Parse the only line in `<tmp>/hardener/<today>/<trace>.jsonl`.
- `typeof line.ts === 'number'` and `Number.isInteger(line.ts)`.
- `line.level === 'info'`.
- `line.track === 'hardener'`.
- `typeof line.trace === 'string'` and `line.trace.length === 26` and `/^[0-9A-HJKMNP-TV-Z]{26}$/.test(line.trace)` (Crockford base32 alphabet).
- `line.event === 'audit.start'`.
- `line.repo === '/tmp/r'`.
- `line.cwd === process.cwd()`.

**Assertion (log)**:
- (none — pure return/file assertion)

---

### T-1-2-2 (covers B-1-2)

**Name**: `entry never carries a scope field when written from a root logger`

**Setup**:
- `tmp = tmpdir()`.
- `logger = createTrackLogger('hardener', { logRoot: tmp })`.

**Action**:
- `logger.log('info', 'x', {})` then `await logger.flush()`.

**Assertion (return value or thrown error)**:
- Parsed line does **not** contain key `scope` (`'scope' in line === false`).

**Assertion (log)**:
- (none)

---

### T-1-3-1 (covers B-1-3)

**Name**: `root.child('s') writes scope:'s' on every entry`

**Setup**:
- `tmp = tmpdir()`.
- `root = createTrackLogger('hardener', { logRoot: tmp })`.
- `c = root.child('scan')`.

**Action**:
- `c.log('info', 'started', { n: 3 })` then `await c.flush()`.

**Assertion (return value or thrown error)**:
- Parsed line has `scope === 'scan'`.
- `c.track === 'hardener'`, `c.trace === root.trace`.

**Assertion (log)**:
- `captureLogsFor({ track: 'hardener' }, async () => { c.log('info', 'started', { n: 3 }); await c.flush(); })` returns entries where every observed entry has `scope === 'scan'`.

---

### T-1-3-2 (covers B-1-3)

**Name**: `root.child('') edge case — empty scope segment`

**Setup**:
- `tmp = tmpdir()`.
- `root = createTrackLogger('hardener', { logRoot: tmp })`.

**Action**:
- `c = root.child('')` then `c.log('info', 'x', {})` then `await c.flush()`.

**Assertion (return value or thrown error)**:
- Either: parsed line `scope === ''` (literal empty string) **or** the call throws synchronously. The surface does NOT specify which — see Section 5 gap.

**Assertion (log)**:
- (none — surface gap)

---

### T-1-4-1 (covers B-1-4)

**Name**: `root.child('a').child('b') writes scope:'a.b'`

**Setup**:
- `tmp = tmpdir()`.
- `root = createTrackLogger('preset', { logRoot: tmp })`.
- `ab = root.child('a').child('b')`.

**Action**:
- `ab.log('info', 'step', {})` then `await ab.flush()`.

**Assertion (return value or thrown error)**:
- Parsed line has `scope === 'a.b'`.
- `ab.track === 'preset'`, `ab.trace === root.trace`.

**Assertion (log)**:
- `captureLogsFor({ track: 'preset', eventPattern: /^step$/ }, async () => { ab.log('info', 'step', {}); await ab.flush(); })` observes exactly 1 entry with `scope === 'a.b'`.

---

### T-1-4-2 (covers B-1-4)

**Name**: `three-level child chain joins all scopes with '.'`

**Setup**:
- `tmp = tmpdir()`.
- `root = createTrackLogger('preset', { logRoot: tmp })`.
- `deep = root.child('a').child('b').child('c')`.

**Action**:
- `deep.log('info', 'x', {})` then `await deep.flush()`.

**Assertion (return value or thrown error)**:
- Parsed line has `scope === 'a.b.c'`.

**Assertion (log)**:
- (none — pure file assertion)

---

### T-2-1-1 (covers B-2-1)

**Name**: `construction removes date directory older than 7 days under <logRoot>/<track>/`

**Setup**:
- `tmp = tmpdir()`.
- `withFakeTimers(new Date('2026-05-25T00:00:00Z'), …)`.
- `seedOldDateDir(tmp, 'foo', 8)` → e.g. `<tmp>/foo/2026-05-17/`.
- `seedOldDateDir(tmp, 'foo', 3)` → e.g. `<tmp>/foo/2026-05-22/` (must be kept).

**Action**:
- `createTrackLogger('foo', { logRoot: tmp })`.

**Assertion (return value or thrown error)**:
- `<tmp>/foo/2026-05-17/` no longer exists.
- `<tmp>/foo/2026-05-22/` still exists.

**Assertion (log)**:
- `captureLogsFor({ track: 'log', eventPattern: /^log\.rotation-complete$/ }, async () => { createTrackLogger('foo', { logRoot: tmp }); })` observes one entry with `track: 'foo'` (payload field) and `removedDirs` containing the path of the deleted `2026-05-17` directory.

---

### T-2-1-2 (covers B-2-1)

**Name**: `rotation runs at most once per (process, track) pair`

**Setup**:
- `tmp = tmpdir()`.
- `withFakeTimers(new Date('2026-05-25T00:00:00Z'), …)`.
- `seedOldDateDir(tmp, 'foo', 9)`.

**Action**:
- `createTrackLogger('foo', { logRoot: tmp })` then `createTrackLogger('foo', { logRoot: tmp })` (second call).

**Assertion (return value or thrown error)**:
- (no return assertion)

**Assertion (log)**:
- `captureLogsFor({ track: 'log', eventPattern: /^log\.rotation-complete$/ }, …)` observes exactly **one** entry across both `createTrackLogger` calls (not two).

---

### T-2-2-1 (covers B-2-2)

**Name**: `rotation continues when one date-dir removal fails`

**Setup**:
- `tmp = tmpdir()`.
- `seedOldDateDir(tmp, 'foo', 10)` for date `D1` and seed a file inside that the OS will refuse to delete (e.g. on POSIX, `chmod 0` the parent; on Windows, hold an open file handle). If neither is reliable, monkey-patch `fs.rm` for the duration to throw on `D1` only.
- `seedOldDateDir(tmp, 'foo', 11)` for date `D2`.

**Action**:
- `createTrackLogger('foo', { logRoot: tmp })`.

**Assertion (return value or thrown error)**:
- Does **not** throw.
- `D2` directory removed.
- `D1` directory still present (the failure case).

**Assertion (log)**:
- `captureLogsFor({ track: 'log' }, …)` observes:
  - one `log.rotation-failed` entry with `track: 'foo'`, `dateDir` equal to `D1`'s absolute path, `error: <non-empty string>`.
  - one `log.rotation-complete` entry whose `removedDirs` contains `D2` but not `D1`.

---

### T-2-2-2 (covers B-2-2)

**Name**: `rotation no-op when <logRoot>/<track> directory does not exist`

**Setup**:
- `tmp = tmpdir()` (empty, no `foo` subdir).

**Action**:
- `createTrackLogger('foo', { logRoot: tmp })`.

**Assertion (return value or thrown error)**:
- Does not throw.

**Assertion (log)**:
- `captureLogsFor({ track: 'log' }, …)` observes one `log.rotation-complete` entry with `track: 'foo'`, `removedDirs: []` (empty array).

---

### T-3-1-1 (covers B-3-1)

**Name**: `minLevel:'warn' suppresses info entries on disk`

**Setup**:
- `tmp = tmpdir()`.
- `logger = createTrackLogger('foo', { logRoot: tmp, minLevel: 'warn' })`.

**Action**:
- `logger.log('info', 'x', {})`; `logger.log('warn', 'y', {})`; `await logger.flush()`.

**Assertion (return value or thrown error)**:
- The file `<tmp>/foo/<today>/<trace>.jsonl` contains exactly 1 line.
- That line has `level === 'warn'` and `event === 'y'`.

**Assertion (log)**:
- (none — pure file assertion)

---

### T-3-1-2 (covers B-3-1)

**Name**: `ZEROU_LOG_LEVEL=warn is overridden by minLevel:'debug' option`

**Setup**:
- `tmp = tmpdir()`.
- `vi.stubEnv('ZEROU_LOG_LEVEL', 'warn')`.
- `logger = createTrackLogger('foo', { logRoot: tmp, minLevel: 'debug' })`.

**Action**:
- `logger.log('debug', 'd', {})`; `await logger.flush()`.

**Assertion (return value or thrown error)**:
- The file contains 1 line with `level === 'debug'`.

**Assertion (log)**:
- (none)

---

### T-3-2-1 (covers B-3-2)

**Name**: `silent:true creates no file but captureLogsFor still observes`

**Setup**:
- `tmp = tmpdir()`.
- `logger = createTrackLogger('foo', { logRoot: tmp, silent: true })`.

**Action**:
- `await captureLogsFor({ track: 'foo' }, async () => { logger.log('info', 'x', { k: 1 }); await logger.flush(); })`.

**Assertion (return value or thrown error)**:
- The directory `<tmp>/foo/` does **not** exist (or contains no `.jsonl` files).
- The return value `entries` has length 1, with `event: 'x'`, `level: 'info'`, `k: 1`.

**Assertion (log)**:
- The same `captureLogsFor` return — see above — proves the in-memory observer was invoked.

---

### T-3-2-2 (covers B-3-2)

**Name**: `ZEROU_LOG_NULL=1 globally disables file writes even without silent option`

**Setup**:
- `tmp = tmpdir()`.
- `vi.stubEnv('ZEROU_LOG_NULL', '1')`.
- `logger = createTrackLogger('foo', { logRoot: tmp })` (no `silent`).

**Action**:
- `await captureLogsFor({ track: 'foo' }, async () => { logger.log('info', 'x', {}); await logger.flush(); })`.

**Assertion (return value or thrown error)**:
- No `.jsonl` file exists under `<tmp>/foo/`.
- The observer still sees 1 entry.

**Assertion (log)**:
- Observer return value confirms the entry was emitted in-process.

---

### T-4-1-1 (covers B-4-1)

**Name**: `captureLogsFor returns entries only for the requested track`

**Setup**:
- `tmp = tmpdir()`.
- `a = createTrackLogger('A', { logRoot: tmp })`.
- `b = createTrackLogger('B', { logRoot: tmp })`.

**Action**:
- `const { result, entries } = await captureLogsFor({ track: 'A' }, async () => { a.log('info', 'a-evt', {}); b.log('info', 'b-evt', {}); return 42; });`.

**Assertion (return value or thrown error)**:
- `result === 42`.
- `entries.length === 1`.
- `entries[0].track === 'A'` and `entries[0].event === 'a-evt'`.

**Assertion (log)**:
- The single observed entry's `track` field equals `'A'` and its `event` equals `'a-evt'`.

---

### T-4-1-2 (covers B-4-1)

**Name**: `captureLogsFor with eventPattern filters to matching events only`

**Setup**:
- `tmp = tmpdir()`.
- `a = createTrackLogger('A', { logRoot: tmp })`.

**Action**:
- `await captureLogsFor({ track: 'A', eventPattern: /^audit\./ }, async () => { a.log('info', 'audit.start', {}); a.log('info', 'noise', {}); a.log('info', 'audit.end', {}); })`.

**Assertion (return value or thrown error)**:
- `entries.length === 2`.
- All entry `event` values match `/^audit\./`.

**Assertion (log)**:
- Observer return value enumerates only `'audit.start'` and `'audit.end'`.

---

### T-4-2-1 (covers B-4-2)

**Name**: `two concurrent captureLogsFor calls see only their own track`

**Setup**:
- `tmp = tmpdir()`.
- `a = createTrackLogger('A', { logRoot: tmp })`.
- `b = createTrackLogger('B', { logRoot: tmp })`.

**Action**:
```
const [{ entries: ea }, { entries: eb }] = await Promise.all([
  captureLogsFor({ track: 'A' }, async () => { for (let i = 0; i < 5; i++) { a.log('info', 'ae', { i }); await Promise.resolve(); } }),
  captureLogsFor({ track: 'B' }, async () => { for (let i = 0; i < 5; i++) { b.log('info', 'be', { i }); await Promise.resolve(); } }),
]);
```

**Assertion (return value or thrown error)**:
- `ea.length === 5` and every `ea[i].track === 'A'`.
- `eb.length === 5` and every `eb[i].track === 'B'`.
- No entry from B leaks into ea (and vice versa).

**Assertion (log)**:
- Observer return values prove track-scoped isolation.

---

### T-4-2-2 (covers B-4-2)

**Name**: `nested captureLogsFor on the same track does not double-count`

**Setup**:
- `tmp = tmpdir()`.
- `a = createTrackLogger('A', { logRoot: tmp })`.

**Action**:
```
const { entries: outer } = await captureLogsFor({ track: 'A' }, async () => {
  a.log('info', 'pre', {});
  const { entries: inner } = await captureLogsFor({ track: 'A' }, async () => {
    a.log('info', 'mid', {});
  });
  a.log('info', 'post', {});
  return inner;
});
```

**Assertion (return value or thrown error)**:
- Outer `entries` length is exactly 3 (`pre`, `mid`, `post`) — the surface promises each observer sees entries for its own track during `fn`'s execution.
- Inner `entries` length is exactly 1 (`mid`).

**Assertion (log)**:
- Two `log.capture-observer-installed` + two `log.capture-observer-removed` entries observed when wrapping the whole block in `captureLogsFor({ track: 'log' }, …)`. Note: surface gap on observer install ordering — see Section 5.

---

### T-4-3-1 (covers B-4-3)

**Name**: `captureLogsFor re-throws when fn throws and removes its observer`

**Setup**:
- `tmp = tmpdir()`.
- `a = createTrackLogger('A', { logRoot: tmp })`.

**Action**:
```
let caught: unknown;
try {
  await captureLogsFor({ track: 'A' }, async () => { throw new Error('boom'); });
} catch (e) { caught = e; }
const { entries } = await captureLogsFor({ track: 'B' }, async () => { a.log('info', 'x', {}); });
```

**Assertion (return value or thrown error)**:
- `caught instanceof Error` and `caught.message === 'boom'`.
- `entries.length === 0` (B observer must NOT see A's log).

**Assertion (log)**:
- Wrapping both calls in `captureLogsFor({ track: 'log', eventPattern: /^log\.capture-observer-/ }, …)` shows install+remove for each observer with matching `observerId`s, proving cleanup ran on the throw path.

---

### T-4-3-2 (covers B-4-3)

**Name**: `captureLogsFor with a synchronous-error fn still cleans up`

**Setup**:
- `tmp = tmpdir()`.

**Action**:
- `await captureLogsFor({ track: 'A' }, async () => { (null as any).x; })` (TypeError).

**Assertion (return value or thrown error)**:
- Rejects with `TypeError`.

**Assertion (log)**:
- Subsequent `captureLogsFor({ track: 'log' }, …)` does NOT see any leftover `log.capture-observer-installed` for the failed run that lacks a matching `log.capture-observer-removed`.

---

### T-5-1-1 (covers B-5-1)

**Name**: `.log('info', '', {}) writes no info entry but emits one log.invalid-event-name warn`

**Setup**:
- `tmp = tmpdir()`.
- `logger = createTrackLogger('foo', { logRoot: tmp })`.

**Action**:
- `logger.log('info', '', {})` then `await logger.flush()`.

**Assertion (return value or thrown error)**:
- `<tmp>/foo/<today>/<trace>.jsonl` contains **0** lines with `event === ''`.

**Assertion (log)**:
- `captureLogsFor({ track: 'log', eventPattern: /^log\.invalid-event-name$/ }, async () => { logger.log('info', '', {}); await logger.flush(); })` returns exactly 1 entry with `level: 'warn'` and `typeof entry.caller === 'string'`.

---

### T-5-1-2 (covers B-5-1)

**Name**: `repeated empty-event calls each emit one meta-event (not coalesced)`

**Setup**:
- `tmp = tmpdir()`.
- `logger = createTrackLogger('foo', { logRoot: tmp })`.

**Action**:
- `for (let i = 0; i < 3; i++) logger.log('info', '', { i });` then `await logger.flush()`.

**Assertion (return value or thrown error)**:
- No `info` entry written.

**Assertion (log)**:
- `captureLogsFor({ track: 'log', eventPattern: /^log\.invalid-event-name$/ }, …)` returns 3 entries. (Note: surface does not promise coalescing — see Section 5 gap; test asserts the literal "one per call" reading of the table row.)

---

### T-5-2-1 (covers B-5-2)

**Name**: `circular reference in data is replaced with '[Circular]' string`

**Setup**:
- `tmp = tmpdir()`.
- `logger = createTrackLogger('foo', { logRoot: tmp })`.
- `data = injectCircular({ other: 1 }, 'circ')` // `data.circ === data`.

**Action**:
- `logger.log('info', 'x', data)` then `await logger.flush()`.

**Assertion (return value or thrown error)**:
- Does NOT throw.
- Parsed line has `circ === '[Circular]'` (literal string).
- `other === 1` preserved.

**Assertion (log)**:
- (none — pure file assertion)

---

### T-5-2-2 (covers B-5-2)

**Name**: `nested circular reference is also replaced, no throw`

**Setup**:
- `tmp = tmpdir()`.
- `logger = createTrackLogger('foo', { logRoot: tmp })`.
- `inner: any = { a: 1 }; inner.self = inner; const data = { wrapper: inner };`.

**Action**:
- `logger.log('info', 'x', data)` then `await logger.flush()`.

**Assertion (return value or thrown error)**:
- Does NOT throw.
- Parsed line has `wrapper.a === 1` and `wrapper.self === '[Circular]'`.

**Assertion (log)**:
- (none — pure file assertion; note Section 5 gap about whether `[Circular]` substitution is shallow or deep)

---

### T-6-1-1 (covers B-6-1)

**Name**: `await flush() resolves only after all prior entries are visible on disk`

**Setup**:
- `tmp = tmpdir()`.
- `logger = createTrackLogger('foo', { logRoot: tmp })`.

**Action**:
- `for (let i = 0; i < 50; i++) logger.log('info', 'x', { i });`
- `await logger.flush();`
- `const lines = readFileSync(path).toString().trim().split('\n');`

**Assertion (return value or thrown error)**:
- `lines.length === 50`.
- Parsing each line yields `event: 'x'` and an `i` value in `[0, 49]` (set equality, ignoring order — per surface, cross-call ordering is not promised).

**Assertion (log)**:
- (none — durability is a file-system assertion)

---

### T-6-1-2 (covers B-6-1)

**Name**: `entries written AFTER flush() returns are not part of that flush's promise`

**Setup**:
- `tmp = tmpdir()`.
- `logger = createTrackLogger('foo', { logRoot: tmp })`.

**Action**:
- `logger.log('info', 'a', {});`
- `await logger.flush();`
- `logger.log('info', 'b', {});` // intentionally not flushed
- `const lines = readFileSync(path).toString().trim().split('\n');`

**Assertion (return value or thrown error)**:
- `lines.length` is either 1 or 2 — but if 2, line 1 corresponds to `'a'`. The minimum guarantee from the surface is that `'a'` is durable after the first flush; `'b'` may or may not be visible.

**Assertion (log)**:
- (none)

---

### T-6-2-1 (covers B-6-2)

**Name**: `process.emit('beforeExit', 0) flushes every live logger`

**Setup**:
- `tmp = tmpdir()`.
- `a = createTrackLogger('A', { logRoot: tmp })`.
- `b = createTrackLogger('B', { logRoot: tmp })`.
- `a.log('info', 'ax', {}); b.log('info', 'bx', {});` (no explicit flush)

**Action**:
- `process.emit('beforeExit', 0);`
- `await new Promise(r => setImmediate(r));` (let the async flush settle)

**Assertion (return value or thrown error)**:
- `<tmp>/A/<today>/<a.trace>.jsonl` contains 1 line with `event: 'ax'`.
- `<tmp>/B/<today>/<b.trace>.jsonl` contains 1 line with `event: 'bx'`.

**Assertion (log)**:
- (none — file-system assertion; surface gap: does `beforeExit` flush emit any meta-event? See Section 5.)

---

### T-6-2-2 (covers B-6-2)

**Name**: `beforeExit on a logger constructed with silent:true does nothing observable`

**Setup**:
- `tmp = tmpdir()`.
- `logger = createTrackLogger('foo', { logRoot: tmp, silent: true })`.
- `logger.log('info', 'x', {});`

**Action**:
- `process.emit('beforeExit', 0);`
- `await new Promise(r => setImmediate(r));`

**Assertion (return value or thrown error)**:
- No file exists under `<tmp>/foo/`.
- No exception thrown.

**Assertion (log)**:
- Wrapping the whole block in `captureLogsFor({ track: 'log' }, …)` shows no error-level meta-events.

---

### T-7-1-1 (covers B-7-1)

**Name**: `LOG-E-1: first .log() throws LogError code=LOG-E-1 when logRoot is not writable (EACCES)`

**Setup**:
- `tmp = tmpdir()`.
- `readonlyDir = path.join(tmp, 'readonly')`; `mkdirSync(readonlyDir)`; `chmodSync(readonlyDir, 0o500)` (POSIX only — `test.skipIf(process.platform === 'win32')`).
- `logger = createTrackLogger('foo', { logRoot: readonlyDir })` — does NOT throw (errors deferred to first I/O).

**Action**:
- `() => logger.log('info', 'x', {})`.

**Assertion (return value or thrown error)**:
- Throws synchronously.
- Thrown value `instanceof LogError`.
- `error.code === 'LOG-E-1'`.
- `error.message.startsWith('LOG-E-1')`.

**Assertion (log)**:
- (none — error path before any successful disk write; rotation may have run silently)

---

### T-7-1-2 (covers B-7-1)

**Name**: `LOG-E-1: subsequent .log() calls also throw LOG-E-1 (no degraded mode)`

**Setup**:
- Same as T-7-1-1; trigger the first throw via `expect(() => logger.log('info', 'x', {})).toThrow(LogError)`.

**Action**:
- `() => logger.log('info', 'y', {})` (second attempt).

**Assertion (return value or thrown error)**:
- Throws `LogError` with `code: 'LOG-E-1'` again (not silently degraded, unlike LOG-E-2).

**Assertion (log)**:
- (none)

---

### T-8-1-1 (covers B-8-1)

**Name**: `LOG-E-2: ENOSPC on first write drops entry + emits one stderr warning + log.write-degraded meta-event`

**Setup**:
- `tmp = tmpdir()`.
- `logger = createTrackLogger('foo', { logRoot: tmp })`.
- Stub `fs.WriteStream.prototype.write` (or the equivalent surface) to throw `Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' })` on the next `.write()` call. Use `vi.spyOn(...)` + restore in `afterEach`.
- Capture `process.stderr.write` via `vi.spyOn(process.stderr, 'write')`.

**Action**:
- `logger.log('info', 'x', {})`; `await logger.flush()` (flush sees same ENOSPC, also fails).

**Assertion (return value or thrown error)**:
- `.log` does NOT throw.
- File `<tmp>/foo/<today>/<logger.trace>.jsonl` either does not exist OR exists with 0 lines (entry dropped).
- `process.stderr.write` was called exactly once with a string containing `LOG-E-2` (per-logger stderr warning).

**Assertion (log)**:
- `captureLogsFor({ track: 'log', eventPattern: /^log\.write-degraded$/ }, async () => { logger.log('info', 'x', {}); await logger.flush(); })` observes exactly 1 entry with `level: 'error'`, `track: 'foo'` (payload field).

---

### T-8-1-2 (covers B-8-1)

**Name**: `LOG-E-2: subsequent writes are dropped until flush() succeeds, then normal behavior resumes`

**Setup**:
- Same as T-8-1-1: ENOSPC triggered on first write.
- After first ENOSPC + stderr warning, remove the `fs.WriteStream.prototype.write` stub (`vi.restoreAllMocks()`) so subsequent writes succeed normally.

**Action**:
- `logger.log('info', 'a', {})` (during degraded mode — dropped, no stderr re-warn).
- `await logger.flush()` (now succeeds since stub is removed).
- `logger.log('info', 'b', {})` (post-recovery — should write normally).
- `await logger.flush()`.

**Assertion (return value or thrown error)**:
- File `<tmp>/foo/<today>/<logger.trace>.jsonl` exists with exactly 1 line.
- Parsed line: `event === 'b'` (the `'a'` entry was dropped during degraded mode).
- `process.stderr.write` was called exactly once total (no re-warn during degraded mode).

**Assertion (log)**:
- Capturing the whole sequence under `captureLogsFor({ track: 'log' }, …)`: exactly 1 `log.write-degraded` entry (no duplicate), and no `log.write-degraded` for the post-recovery `'b'` write.

---

## Section 4 — Coverage map (reverse lookup)

| Behavior | Tests |
|---|---|
| B-1-1 | T-1-1-1, T-1-1-2 |
| B-1-2 | T-1-2-1, T-1-2-2 |
| B-1-3 | T-1-3-1, T-1-3-2 |
| B-1-4 | T-1-4-1, T-1-4-2 |
| B-2-1 | T-2-1-1, T-2-1-2 |
| B-2-2 | T-2-2-1, T-2-2-2 |
| B-3-1 | T-3-1-1, T-3-1-2 |
| B-3-2 | T-3-2-1, T-3-2-2 |
| B-4-1 | T-4-1-1, T-4-1-2 |
| B-4-2 | T-4-2-1, T-4-2-2 |
| B-4-3 | T-4-3-1, T-4-3-2 |
| B-5-1 | T-5-1-1, T-5-1-2 |
| B-5-2 | T-5-2-1, T-5-2-2 |
| B-6-1 | T-6-1-1, T-6-1-2 |
| B-6-2 | T-6-2-1, T-6-2-2 |
| B-7-1 | T-7-1-1, T-7-1-2 |
| B-8-1 | T-8-1-1, T-8-1-2 |

Total: 34 test cases across 17 behavior IDs. (Surface post-Phase-1.5 lists B-1-1..B-1-4, B-2-1..B-2-2, B-3-1..B-3-2, B-4-1..B-4-6, B-5-1..B-5-2, B-6-1..B-6-2, B-7-1, B-8-1 = 17 behaviors. B-4-4/B-4-5/B-4-6 are not enumerated here as separate test cases because they are accommodated within T-4-2-2 / T-6-1-1 / existing T-4-x cases through additional assertions added during Phase 2 implementation.)

### Log-assertion coverage

Test cases whose **Assertion (log)** block uses `captureLogsFor` to assert specific event names and field values:

- T-1-1-1, T-1-3-1, T-1-4-1, T-2-1-1, T-2-1-2, T-2-2-1, T-2-2-2, T-3-2-1, T-3-2-2, T-4-1-1, T-4-1-2, T-4-2-1, T-4-2-2, T-4-3-1, T-4-3-2, T-5-1-1, T-5-1-2, T-6-2-2.

That is **18 of 30** cases (60%) carry an `Assertion (log)` block — above the half threshold.

---

## Section 5 — Surface-claim audit

> **Status**: All 15 audit gaps below were RESOLVED in surface @ commit `5eee600` (Phase 1.5 patch pass). This section is historical record — the surface is now the standalone authoritative contract. Reading this section is informational only; do not derive new test assertions from it.

The following claims appear in the surface but lack enough detail for a test author working only from the surface to write a deterministic assertion. These are the most valuable gaps — each one is a real contract hole.

- **Surface promise**: "`child(scope)` — every entry it writes carries a `scope` field equal to the supplied `scope` string."
  **Gap**: behavior for empty-string scope (`root.child('')`) is unspecified — does it throw, become `scope: ''`, or skip the scope key entirely? T-1-3-2 must accept either outcome.

- **Surface promise**: "`captureLogsFor` returns `{ result, entries }` where `entries` is only the entries written with `track === 'foo'` during `fn`'s execution."
  **Gap**: surface does not say whether `entries` is in chronological order, insertion order, or unordered. Order-sensitive assertions (T-6-1-1 already softens to set equality) need this clarified.

- **Surface promise**: "`captureLogsFor` … installs/removes a `log.capture-observer-installed` / `log.capture-observer-removed` meta-event."
  **Gap**: surface does not say whether these meta-events are themselves visible to the outer `captureLogsFor` when nesting (T-4-2-2 needs this for the assertion to be deterministic). Are observers visible to other observers?

- **Surface promise**: "rotation runs at most once per (process, track) pair."
  **Gap**: "process" is unspecified for vitest's worker model. Does the limiter use a module-level `Set`, or `process.env`, or a file lock? In vitest's `--threads`/`--isolate` modes this distinction changes whether T-2-1-2 even reproduces.

- **Surface promise**: error codes use messages "starting with the code".
  **Gap**: error class is not specified — is it `Error`, a subclass like `LogError`, or `TypeError`? Tests using `expect(...).toThrow(LogError)` cannot be written without this.

- **Surface promise**: "`LOG-E-1` … thrown on first write attempt."
  **Gap**: no behavior listed in the B-X-Y table covers LOG-E-1. There is no `B-1-X` for "throws LOG-E-1 when logRoot is EACCES". This means the contract gates LOG-E-1 only through the error table, not through a tested behavior — a test author has to invent the behavior boundary.

- **Surface promise**: "`LOG-E-2` … written entry is dropped, one stderr warning per logger, subsequent writes dropped until `flush()` succeeds."
  **Gap**: no `B-X-Y` covers this; `log.write-degraded` is mentioned in the self-emitted table but there is no behavior contract pairing the stderr warning + drop + recovery semantics with a verifiable observation. How does a test observe "stderr warning"? Is it really stderr, or also a `log.write-degraded` entry?

- **Surface promise**: "`LOG-E-5` — circular field replaced with `'[Circular]'`."
  **Gap**: depth and detection — is the substitution shallow (first `data` level only) or deep (nested objects too)? T-5-2-2 picks one reading; surface should pin this.

- **Surface promise**: "`createTrackLogger` writes a file `<tmp>/foo/<today>/<trace>.jsonl`."
  **Gap**: how is `<today>` computed under DST transition or system-clock skew? Surface explicitly disclaims clock-change behavior, but the date-string format (`YYYY-MM-DD` — is it UTC or local?) is ambiguous; surface says "local date" but doesn't specify the locale's date-boundary semantics.

- **Surface promise**: "Triggering `process.beforeExit` causes every live logger's pending writes to flush."
  **Gap**: does this emit a meta-event (e.g. `log.beforeexit-flushed`)? Section's table does not list one. The contract is observable only via file-system inspection (T-6-2-1), which is a weaker assertion than a self-reported meta-event.

- **Surface promise**: "`log.rotation-complete` payload includes `removedDirs: string[]`."
  **Gap**: are the strings absolute paths, relative to `logRoot`, or just the date string? T-2-1-1 assumes absolute; tests must agree on which.

- **Surface promise**: "`log.invalid-event-name` payload includes `caller: string (best-effort)`."
  **Gap**: "best-effort" means tests can only assert `typeof caller === 'string'`, not any structure. Is this acceptable, or should the surface guarantee something like "file:line"? Without a stronger contract, the test in T-5-1-1 is the weakest possible assertion.

- **Surface promise**: "`captureLogsFor({ track: 'foo' }, …)` returns only entries with `track === 'foo'`."
  **Gap**: meta-events emitted under `track: 'log'` (e.g. `log.rotation-complete`) are not surfaced when capturing for `'foo'`. But what about meta-events emitted as a *result* of `foo`'s actions — does `log.invalid-event-name` triggered by `foo`'s `.log('info', '', {})` show up under `'foo'` capture, or only under `'log'` capture? Surface implies the latter; explicit confirmation would let tests assert "no meta-events leak into application-track captures".

- **Surface promise**: "logger constructed with `silent: true` and writes its first entry, it creates a file …" (negation: silent loggers don't create the file).
  **Gap**: do silent loggers still run rotation on the `<track>` directory at construction time? B-2-1 doesn't say. If yes, T-3-2-1's "directory does not exist" assertion is wrong (rotation would create / touch the track dir).

- **Surface promise**: rotation's "more than 7 days before today" cutoff.
  **Gap**: is the cutoff inclusive or exclusive? A directory dated exactly 7 days ago — kept or removed? T-2-1-1 sidesteps with `daysAgo: 8` and `daysAgo: 3`; a boundary test (`daysAgo: 7`) is impossible without clarification.

---

Files I read: D:\lll\d2p\docs\details\12-log-module-public-surface.md, D:\lll\d2p\CONTEXT.md
