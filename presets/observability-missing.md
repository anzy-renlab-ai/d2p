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
  - ruleId: request-no-logger
    label: Express / Fastify / Koa app bootstrap with no request logger middleware
    severity: P2
    mechanism: llm-judgment
    source: observability-missing/v2
    rationale: "Without `pino-http` / `morgan` / `@fastify/request-logger` / `koa-pino-logger`, no per-request log line is emitted. Operators cannot tell which requests arrived, how long they took, or what status they returned. The LLM verifies an app instance exists and no logger middleware was attached."
    detection:
      pattern: (express|fastify|koa|hono|nestFactory)\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: install pino-http and app.use(pinoHttp({ logger })); each request will now log method/url/status/latency as JSON'"
      verifyCommand: "grep -rE 'pino-http|pinoHttp|morgan|@fastify/request-logger|koa-pino-logger' src/"
  - ruleId: no-correlation-id
    label: No request / correlation ID propagation in handlers
    severity: P3
    mechanism: llm-judgment
    source: observability-missing/v2
    rationale: "Without an `X-Request-Id` (or `traceparent`) propagated through logs and outbound calls, debugging a single failing request requires manual log grep across services. Generate / accept a correlation ID at the edge, store on `req.id`, include in every log line and every outbound fetch header."
    detection:
      pattern: (x-request-id|X-Request-Id|requestId|correlationId|traceparent|trace-id)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: install express-request-id (or hand-rolled middleware); attach req.id; include in logger.child({reqId}) and outbound fetch headers'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: metric-instrumentation-missing
    label: No metrics SDK (prom-client / OpenTelemetry / Datadog APM) referenced anywhere
    severity: P3
    mechanism: llm-judgment
    source: observability-missing/v2
    rationale: "Logs answer 'what happened to this one request'; metrics answer 'what is the current 99th percentile latency'. Without a metrics SDK (prom-client, @opentelemetry/api, dd-trace, statsd) operators cannot alert on regressions before users notice. Pick one and expose `/metrics` or auto-export to a backend."
    detection:
      pattern: (prom-client|@opentelemetry|dd-trace|statsd|@datadog/datadog-ci|@newrelic)
      filePattern: package.json
    fix:
      kind: llm-only
      command: "echo 'manual remediation: install prom-client (self-hosted Prometheus) or @opentelemetry/sdk-node + auto-instrumentations (vendor-neutral). Expose GET /metrics for Prometheus scraping.'"
      verifyCommand: "grep -E 'prom-client|@opentelemetry|dd-trace|statsd' package.json"
  - ruleId: stdout-not-stderr-for-errors
    label: Error-level log routed to console.log instead of console.error
    severity: P3
    mechanism: static-grep
    source: observability-missing/v2
    rationale: "`console.log` writes to stdout; `console.error` writes to stderr. Many log shippers (journald, Docker, k8s logging drivers) tag stream as `stdout`/`stderr` and severity defaults follow. Sending errors to stdout means alerting rules that filter on stream lose them. Use the structured logger; failing that, route errors to `console.error`."
    detection:
      pattern: console\.log\s*\(\s*['"`][^'"`]*(error|fail|exception|crash|panic|fatal)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: route errors via logger.error(...) (structured) or at minimum console.error(...)'"
      verifyCommand: "! grep -riE 'console\\.log\\s*\\(\\s*[\\`'\\''\"][^\\`'\\''\"]*(error|fail|exception|crash|panic|fatal)' src/"
  - ruleId: stack-trace-in-prod-response
    label: res.send(error.stack) — stack trace echoed to client
    severity: P1
    mechanism: static-grep
    source: observability-missing/v2
    rationale: "`res.send(err.stack)` (or `res.write(err.stack)`) shows the client every file path, library version, and function name in the call chain. In production this is an information disclosure that aids attackers fingerprinting your stack and finding internal endpoints. Log server-side, return a generic envelope."
    detection:
      pattern: res\.(send|write|end|json)\s*\([^)]*\.stack\b
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: logger.error({err}, \"handler failed\"); res.status(500).json({error: \"internal_error\", requestId})'"
      verifyCommand: "! grep -rE 'res\\.(send|write|end|json)\\s*\\([^)]*\\.stack\\b' src/"
---

# Observability gap check

Silent failures are the worst failures. This preset finds the observability
gaps that turn debuggable incidents into multi-hour outages:

1. **`silent-catch-block`** — `catch (e) {}` erases failure signal.
2. **`console-log-in-prod-paths`** — unstructured logs cannot be queried or
   filtered by ops tooling.
3. **`missing-error-tracking-import`** — no Sentry / Datadog / Honeybadger
   anywhere means uncaught exceptions die in logs without alerting.
4. **`missing-health-endpoint`** — load balancers and k8s probes need
   `/health` to route traffic safely.
5. **`mutating-endpoint-without-log`** — write paths must log so incident
   responders can reconstruct timelines.
6. **`request-no-logger`** — app bootstrap with no pino-http / morgan; no
   per-request line means you cannot tell what arrived.
7. **`no-correlation-id`** — without a request id propagated to logs and
   outbound calls, single-request debugging requires manual log grep.
8. **`metric-instrumentation-missing`** — no prom-client / OpenTelemetry
   / Datadog; you only learn about a regression from a user report.
9. **`stdout-not-stderr-for-errors`** — error logs on stdout bypass
   alerting rules that filter by stream.
10. **`stack-trace-in-prod-response`** — `res.send(e.stack)` fingerprints
    your stack to the client.

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
