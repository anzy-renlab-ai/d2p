---
id: error-handling
version: 2
name: Error handling discipline check
appliesTo: []
rules:
  - ruleId: stack-trace-leak-in-response
    label: Response body contains stack trace or serialised Error
    severity: P1
    mechanism: static-grep
    source: error-handling/v2
    rationale: Returning `e.stack` (or `JSON.stringify(e)`) in an HTTP response leaks file paths, library versions, and call structure — gold dust for attackers. Always log the stack server-side and return a generic message to the client.
    detection:
      pattern: res\.(status\([0-9]+\)\.)?(json|send)\s*\(\s*\{[^}]*(stack|JSON\.stringify\s*\(\s*e\b|JSON\.stringify\s*\(\s*err\b)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: log the stack server-side (logger.error({ err })), return a generic body — res.status(500).json({ error: \"internal_error\", requestId })'"
      verifyCommand: "! grep -rE 'res\\.(status\\([0-9]+\\)\\.)?(json|send)\\s*\\(\\s*\\{[^}]*(stack|JSON\\.stringify\\s*\\(\\s*e\\b|JSON\\.stringify\\s*\\(\\s*err\\b)' src/"
  - ruleId: catch-all-swallow
    label: Promise chain swallows errors via .catch(() => undefined)
    severity: P2
    mechanism: static-grep
    source: error-handling/v2
    rationale: `.catch(() => undefined)` (or `.catch(() => null)`, `.catch(() => {})`) discards the rejection without logging. Downstream code thinks the call succeeded and operates on `undefined`, leading to corrupt state. Either re-throw or log and return a default explicitly.
    detection:
      pattern: \.catch\s*\(\s*\(\s*\)\s*=>\s*(undefined|null|\{\s*\}|void\s+0)\s*\)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace .catch(() => undefined) with .catch((e) => { logger.error({ err: e }); return defaultValue; }) — never erase the error silently'"
      verifyCommand: "! grep -rE '\\.catch\\s*\\(\\s*\\(\\s*\\)\\s*=>\\s*(undefined|null|\\{\\s*\\}|void\\s+0)\\s*\\)' src/"
  - ruleId: throw-non-error
    label: Throw of string / number / object literal instead of Error
    severity: P2
    mechanism: static-grep
    source: error-handling/v2
    rationale: `throw 'oops'` produces a value with no stack trace, no name, no instanceof check. Downstream `catch` blocks cannot rely on `e.message` or `e instanceof MyError`. Always throw an Error subclass so stack traces and type-narrowing work.
    detection:
      pattern: throw\s+(['"`][^'"`]*['"`]|[0-9]+|\{[^}]*\})\s*;?
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: wrap in Error — throw new Error(\"validation failed\") — or define a custom Error subclass for typed handling'"
      verifyCommand: "! grep -rE 'throw\\s+([\\`'\\''\"][^\\`'\\''\"]*[\\`'\\''\"]|[0-9]+|\\{[^}]*\\})\\s*;?' src/"
  - ruleId: missing-global-error-handler
    label: Express app has no error-handling middleware
    severity: P2
    mechanism: llm-judgment
    source: error-handling/v2
    rationale: Without a final `app.use((err, req, res, next) => …)` Express defaults to its built-in handler, which leaks stack traces in development and returns terse 500s in production. A custom global handler is required to log via your structured logger, attach request IDs, and return a consistent error envelope.
    detection:
      pattern: app\.use\s*\(\s*(async\s*)?\(\s*err\s*[,:]
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: add app.use((err, req, res, _next) => { logger.error({ err, reqId: req.id }); res.status(err.status||500).json({ error: err.code||\"internal\" }); }) as the LAST middleware'"
      verifyCommand: "grep -rE 'app\\.use\\s*\\(\\s*(async\\s*)?\\(\\s*err\\s*[,:]' src/"
  - ruleId: unawaited-promise-in-handler
    label: Promise returned without await inside async request handler
    severity: P3
    mechanism: llm-judgment
    source: error-handling/v2
    rationale: A floating promise inside an async handler (e.g. `db.save(x); res.json(ok)`) means rejections never reach Express's error middleware — they surface as `unhandledRejection` and crash the process. Always `await` or chain a `.catch(next)`.
    detection:
      pattern: (?:async\s*\([^)]*\)\s*=>\s*\{|async\s+function[^{]+\{)[^}]*\n\s*(?!await\s)(?!return\s)[a-zA-Z_$][a-zA-Z0-9_$.]*\([^)]*\)\.then
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: await every promise inside handlers, or use express-async-errors and let the global handler catch them'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: unhandled-rejection
    label: ".catch wired to a no-op (`.catch(noop)` / `.catch(() => {})`)"
    severity: P1
    mechanism: static-grep
    source: error-handling/v2
    rationale: ".catch(noop) or .catch(() => {}) intercepts the rejection just enough to silence unhandledRejection alerts, while erasing all signal. Downstream code believes the call succeeded and operates on stale/undefined data. Either log + return a sensible default, or re-throw."
    detection:
      pattern: \.catch\s*\(\s*(noop|\(\s*[a-zA-Z_$]?\s*\)\s*=>\s*\{\s*\})\s*\)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace .catch(noop) with .catch((e) => logger.error({err: e}, \"context\")); never silently absorb rejections'"
      verifyCommand: "! grep -rE '\\.catch\\s*\\(\\s*(noop|\\(\\s*[a-zA-Z_$]?\\s*\\)\\s*=>\\s*\\{\\s*\\})\\s*\\)' src/"
  - ruleId: missing-await-async
    label: Async function returns another async call without await
    severity: P2
    mechanism: llm-judgment
    source: error-handling/v2
    rationale: "`async function f() { return otherAsync(); }` works but rejections from `otherAsync` lose the `f` frame in the stack trace (no longer captured because `return` does not anchor the await). Inside try/catch the rejection escapes `f`'s catch entirely. Use `return await otherAsync()` so rejections are caught and stack traces include `f`."
    detection:
      pattern: async\s+(function|\([^)]*\)\s*=>)[\s\S]{0,400}?\breturn\s+[a-zA-Z_$][a-zA-Z0-9_$.]*\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: when the returned value is a promise and surrounding try/catch must apply, write `return await x()` instead of `return x()`'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: promise-never-resolved
    label: new Promise(executor) with a code path that never resolves or rejects
    severity: P2
    mechanism: llm-judgment
    source: error-handling/v2
    rationale: "`new Promise((resolve, reject) => { if (ok) resolve(x); /* else: nothing */ })` returns a forever-pending promise on the `else` branch. Awaiters hang indefinitely, holding handler slots and DB connections. Every branch must call resolve or reject (or throw)."
    detection:
      pattern: new\s+Promise\s*\(\s*(async\s+)?\(\s*(resolve|[a-zA-Z_$])\s*,\s*(reject|[a-zA-Z_$])\s*\)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: ensure every branch of the executor calls resolve(...) or reject(...). Wrap synchronous throws in try/catch -> reject.'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: error-cast-as-message
    label: .message accessed on caught error without instanceof Error check
    severity: P2
    mechanism: static-grep
    source: error-handling/v2
    rationale: "In modern TS, `catch (e)` types `e` as `unknown`. `e.message` then is a type error or, with `as any`, a runtime `undefined` when the thrown value was a string / number / null. Always narrow with `e instanceof Error` first."
    detection:
      pattern: catch\s*\(\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\)\s*\{[^}]*\1\.message
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: const msg = e instanceof Error ? e.message : String(e); — never access .message on unknown'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: error-leak-to-client
    label: Raw error object sent in HTTP response body
    severity: P1
    mechanism: static-grep
    source: error-handling/v2
    rationale: "`res.status(500).json({ err })` or `res.json(error)` leaks message + stack to the client. In dev that is a debug aid; in production it discloses file paths, library versions, env-derived state, and sometimes secrets. Log server-side, return a generic envelope with a request id. Excludes lines that also contain `stack:` since `stack-trace-leak-in-response` is the more specific finding for those."
    detection:
      pattern: ^(?!.*stack\s*:).*res\.(status\s*\([0-9]+\)\s*\.)?(json|send)\s*\(\s*\{?\s*(err|error|e)\s*[,:}]
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: logger.error({err, reqId}, \"handler failed\"); res.status(500).json({ error: \"internal_error\", requestId: reqId });'"
      verifyCommand: "! grep -rE 'res\\.(status\\s*\\([0-9]+\\)\\s*\\.)?(json|send)\\s*\\(\\s*\\{?\\s*(err|error|e)\\s*[,:}]' src/"
  - ruleId: process-event-no-handler
    label: No process.on('uncaughtException' / 'unhandledRejection') registered
    severity: P2
    mechanism: llm-judgment
    source: error-handling/v2
    rationale: "Node 15+ defaults `unhandledRejection` to `throw`, which crashes the process. Without an explicit `process.on('uncaughtException', ...)` and `process.on('unhandledRejection', ...)` that *logs* before exiting, the crash leaves no breadcrumb. Register both at app bootstrap; log via your structured logger; then exit (do not swallow)."
    detection:
      pattern: process\.on\s*\(\s*['"`](uncaughtException|unhandledRejection)['"`]
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: at bootstrap — process.on(\"unhandledRejection\", (reason) => { logger.fatal({reason}); process.exit(1); }); same for uncaughtException'"
      verifyCommand: "grep -rE 'process\\.on\\s*\\(\\s*[\\`'\\''\"](uncaughtException|unhandledRejection)[\\`'\\''\"]' src/"
  - ruleId: fs-async-no-error-handling
    label: fs callback used without checking the err parameter first
    severity: P2
    mechanism: static-grep
    source: error-handling/v2
    rationale: "Node fs callbacks follow `(err, data) => ...`. Code shaped `fs.readFile(p, (err, data) => { use(data) })` reaches into `data` even when `err` is set (and `data` is undefined), causing a NPE that masks the real I/O failure. Always early-return on err, or use `fs/promises` + try/catch."
    detection:
      pattern: fs\.(readFile|writeFile|stat|readdir|unlink|appendFile|access)\s*\([^)]*,\s*(async\s+)?\(\s*err\s*,\s*[a-zA-Z_$]
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: migrate to fs/promises — const data = await readFile(path); — and wrap in try/catch. Or in the callback: if (err) return callback(err);'"
      verifyCommand: "echo 'manual review required'"
---

# Error handling discipline check

Vibe-coded apps frequently get error handling subtly wrong in ways that work
fine in dev but explode in production. This preset catches the most damaging
patterns:

1. **`stack-trace-leak-in-response`** — `res.json({ stack: e.stack })` leaks
   internal paths to anyone who can trigger an error.
2. **`catch-all-swallow`** — `.catch(() => undefined)` erases failure signal
   and corrupts downstream state.
3. **`throw-non-error`** — `throw 'oops'` produces an Error-shaped value with
   no stack and breaks `instanceof` checks.
4. **`missing-global-error-handler`** — Express without a final error
   middleware leaks stack traces and returns inconsistent error envelopes.
5. **`unawaited-promise-in-handler`** — floating promises bypass Express's
   error handler and crash the process via `unhandledRejection`.
6. **`unhandled-rejection`** — `.catch(noop)` / `.catch(() => {})` silences
   unhandledRejection alerts while erasing all signal.
7. **`missing-await-async`** — `return otherAsync()` from an async function
   strips the frame from stack traces and escapes surrounding try/catch.
8. **`promise-never-resolved`** — `new Promise` executor with a branch that
   forgets to call resolve/reject; awaiters hang forever.
9. **`error-cast-as-message`** — `.message` accessed on `unknown` caught
   error without an `instanceof Error` narrowing.
10. **`error-leak-to-client`** — `res.json({ err })` leaks message + stack
    to the client.
11. **`process-event-no-handler`** — no `process.on('unhandledRejection')`
    / `'uncaughtException'`; crashes leave no breadcrumb.
12. **`fs-async-no-error-handling`** — fs callback consumes `data` without
    checking `err` first.

## Remediation

### Safe error response

```js
// Bad
app.use((err, req, res, _next) => {
  res.status(500).json({ error: err.message, stack: err.stack });
});

// Good
app.use((err, req, res, _next) => {
  logger.error({ err, reqId: req.id }, 'unhandled');
  res.status(err.status ?? 500).json({
    error: err.code ?? 'internal_error',
    requestId: req.id,
  });
});
```

### Always throw Error

```js
// Bad
if (!user) throw 'not found';

// Good
class NotFoundError extends Error { status = 404; code = 'not_found'; }
if (!user) throw new NotFoundError('user not found');
```

### Don't swallow rejections

```js
// Bad
const data = await fetch(url).catch(() => undefined);

// Good
const data = await fetch(url).catch((e) => {
  logger.warn({ err: e, url }, 'fetch failed');
  return null;
});
```

After applying fixes, re-run `zerou audit` and confirm zero findings remain.
