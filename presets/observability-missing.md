---
id: observability-missing
version: 2
name: Observability gap check (logging, tracing, health)
appliesTo: []
rules:
  - ruleId: silent-catch-block
    label: Catch block silently swallows errors
    severity: P2
    mechanism: static-grep
    source: observability-missing/v2
    rationale: Empty catch blocks (`catch (e) {}`) or catches that return null/undefined erase failure signal. When a production bug fires nothing ever surfaces in logs — the system fails silently. At minimum, log the error before swallowing.
    detection:
      pattern: catch\s*\([^)]*\)\s*\{\s*(\}|return\s+(null|undefined|void\s+0)\s*;?\s*\})
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: at minimum log the error before returning — catch (e) { logger.error({ err: e }, \"context\"); return null; }'"
      verifyCommand: "! grep -rE 'catch\\s*\\([^)]*\\)\\s*\\{\\s*(\\}|return\\s+(null|undefined|void\\s+0)\\s*;?\\s*\\})' src/"
  - ruleId: console-log-in-prod-paths
    label: Production code uses console.log instead of structured logger
    severity: P3
    mechanism: static-grep
    source: observability-missing/v2
    rationale: `console.log` writes unstructured strings to stdout — no severity, no correlation ID, no JSON. Operators cannot grep, filter, or pipe these into Datadog/Loki. Use pino/winston/bunyan instead.
    detection:
      pattern: console\.(log|info|warn|error)\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace console.* with structured logger (pino/winston). Reserve console.* for CLI tools.'"
      verifyCommand: "! grep -rE 'console\\.(log|info|warn|error)\\s*\\(' src/"
  - ruleId: missing-error-tracking-import
    label: No error-tracking SDK imported anywhere
    severity: P2
    mechanism: llm-judgment
    source: observability-missing/v2
    rationale: Production apps need an error tracker (Sentry, Datadog APM, Honeybadger, Rollbar, Bugsnag) to capture uncaught exceptions with stack traces and breadcrumbs. Server logs alone miss client-side errors and lack alerting. This rule flags the absence of any such SDK reference in source.
    detection:
      pattern: ^(?!.*\b(@sentry|@datadog|honeybadger|rollbar|bugsnag|@newrelic)\b).*package\.json$
      filePattern: package.json
    fix:
      kind: llm-only
      command: "echo 'manual remediation: install and initialise @sentry/node (or equivalent). Add Sentry.init() at app bootstrap. Wrap Express with Sentry.Handlers.errorHandler().'"
      verifyCommand: "grep -E '@sentry|@datadog|honeybadger|rollbar|bugsnag|@newrelic' package.json"
  - ruleId: missing-health-endpoint
    label: No /health or /healthz endpoint defined
    severity: P2
    mechanism: llm-judgment
    source: observability-missing/v2
    rationale: Load balancers, Kubernetes probes, and uptime monitors all depend on a health endpoint. Without one, rolling deploys cannot tell when the new pod is ready and outages take longer to detect. Expose `/health` returning 200 once dependencies (DB, cache) respond.
    detection:
      pattern: (app|router|server)\.(get|all)\s*\(\s*['"`]/(health|healthz|_health|ping|status)['"`]
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: add app.get(\"/health\", (_, res) => res.json({ status: \"ok\" })) — gate it on DB ping if dependencies must be healthy too'"
      verifyCommand: "grep -rE '(app|router|server)\\.(get|all)\\s*\\(\\s*[\\`'\\''\"]\\/(health|healthz|_health|ping|status)[\\`'\\''\"]' src/"
  - ruleId: mutating-endpoint-without-log
    label: POST/PUT/DELETE handler has no logger call
    severity: P3
    mechanism: llm-judgment
    source: observability-missing/v2
    rationale: Mutating endpoints (writes to DB, side effects, billing) must emit at least one structured log line per request so operators can reconstruct what happened. A POST that succeeds silently is invisible during incident response.
    detection:
      pattern: \.(post|put|delete|patch)\s*\([^)]+,\s*(async\s*)?\([^)]*\)\s*=>\s*\{(?:(?!logger\.|log\.|console\.|trace\.|info\.|warn\.|error\.).)*\}
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: emit logger.info({ userId, action, payload }) at the top of every mutating handler. Use a structured logger, not console.'"
      verifyCommand: "echo 'manual review required'"
---

# Observability gap check

Silent failures are the worst failures. This preset finds five common
observability gaps that turn debuggable incidents into multi-hour outages:

1. **`silent-catch-block`** — `catch (e) {}` erases failure signal.
2. **`console-log-in-prod-paths`** — unstructured logs cannot be queried or
   filtered by ops tooling.
3. **`missing-error-tracking-import`** — no Sentry / Datadog / Honeybadger
   anywhere means uncaught exceptions die in logs without alerting.
4. **`missing-health-endpoint`** — load balancers and k8s probes need
   `/health` to route traffic safely.
5. **`mutating-endpoint-without-log`** — write paths must log so incident
   responders can reconstruct timelines.

## Remediation

### Replace silent catch

```js
// Bad
try { await charge(); } catch (e) {}

// Good
try { await charge(); }
catch (e) {
  logger.error({ err: e, userId, amount }, 'charge failed');
  throw e; // re-throw if caller needs to know
}
```

### Add Sentry (Node + Express)

```js
import * as Sentry from '@sentry/node';
Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
app.use(Sentry.Handlers.requestHandler());
// ... routes ...
app.use(Sentry.Handlers.errorHandler());
```

### Health endpoint

```js
app.get('/health', async (_, res) => {
  await db.raw('SELECT 1');
  res.json({ status: 'ok', uptime: process.uptime() });
});
```

After applying fixes, re-run `zerou audit` and confirm zero findings remain.
