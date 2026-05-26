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
---

# Error handling discipline check

Vibe-coded apps frequently get error handling subtly wrong in ways that work
fine in dev but explode in production. This preset catches the five most
damaging patterns:

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
