---
id: deploy-incident
version: 2
name: Deploy / incident readiness
appliesTo: []
rules:
  - ruleId: debug-mode-in-prod-config
    label: Debug mode enabled in server config
    severity: P1
    mechanism: static-grep
    source: deploy-incident/v2
    rationale: "Patterns like `debug: true`, `DEBUG=*`, or `NODE_ENV !== 'production'` checks that fall through to dev branches in shipped server code leak stack traces, secrets, and slow paths in production. Gate dev-only code on positive checks (NODE_ENV === 'development') and never default to debug."
    detection:
      pattern: "(debug\\s*[:=]\\s*true|DEBUG\\s*=\\s*['\"]?\\*|NODE_ENV\\s*!==?\\s*['\"]production['\"])"
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation required: invert NODE_ENV checks to positive form (=== development); remove debug:true defaults; gate verbose logging on explicit LOG_LEVEL env'"
      verifyCommand: "! grep -rEn '(debug\\s*[:=]\\s*true|NODE_ENV\\s*!==?\\s*.production.)' src/"
  - ruleId: missing-health-endpoint
    label: No /health or /healthz endpoint detected
    severity: P2
    mechanism: llm-judgment
    source: deploy-incident/v2
    rationale: "Load balancers, Kubernetes liveness probes, uptime monitors, and incident playbooks all require a cheap health endpoint. Without one, traffic routes to dead pods and incidents take longer to detect. Standard endpoints — /health, /healthz, /api/health, /_health."
    detection:
      pattern: "['\"]/(health|healthz|_health|api/health|api/healthz|ping|status)['\"]"
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation required: add GET /health returning 200 + JSON { status, uptime, version }. Keep it dependency-free (no DB call) for fastest liveness signal.'"
      verifyCommand: "grep -rEn '[\"\\x27]/(health|healthz|_health|api/health|ping|status)[\"\\x27]' src/"
  - ruleId: missing-incident-runbook
    label: No RUNBOOK.md / INCIDENT.md / DEPLOY.md file
    severity: P2
    mechanism: file-exists
    source: deploy-incident/v2
    rationale: "At 3 AM during an incident the on-call needs to know how to roll back, how to scale, who to page, and where logs live. A written runbook (even one page) cuts mean-time-to-recovery by an order of magnitude. Standard names — RUNBOOK.md, INCIDENT.md, DEPLOY.md, docs/runbook.md."
    detection:
      paths:
        - RUNBOOK.md
        - INCIDENT.md
        - DEPLOY.md
        - docs/RUNBOOK.md
        - docs/INCIDENT.md
        - docs/DEPLOY.md
        - docs/runbook.md
        - docs/incident.md
        - docs/deploy.md
      expect: present
    fix:
      kind: template
      command: "echo 'manual remediation required: create RUNBOOK.md with sections — Rollback Procedure / Scale Up / Page Schedule / Log Locations / Common Failures'"
      verifyCommand: "test -f RUNBOOK.md -o -f INCIDENT.md -o -f DEPLOY.md -o -f docs/RUNBOOK.md -o -f docs/runbook.md"
  - ruleId: missing-monitoring-config
    label: No monitoring / error-reporting integration detected
    severity: P2
    mechanism: file-exists
    source: deploy-incident/v2
    rationale: "Production without monitoring is flying blind; you learn of outages from customers on Twitter. Install one of Sentry / Datadog / New Relic / Honeycomb / OpenTelemetry and ship at minimum error reporting + uptime checks."
    detection:
      paths:
        - sentry.client.config.ts
        - sentry.server.config.ts
        - datadog.yaml
        - datadog-ci.json
        - newrelic.js
        - newrelic.config.js
        - honeycomb.yaml
        - otel-collector-config.yaml
        - node_modules/@sentry/node/package.json
        - node_modules/@sentry/nextjs/package.json
        - node_modules/dd-trace/package.json
        - node_modules/newrelic/package.json
        - node_modules/@opentelemetry/sdk-node/package.json
      expect: present
    fix:
      kind: template
      command: "echo 'manual remediation required: npm install @sentry/node (or @sentry/nextjs) and initialise in server entry; add a sentry.server.config.ts; set SENTRY_DSN in deploy env'"
      verifyCommand: "test -f sentry.server.config.ts -o -f sentry.client.config.ts -o -f datadog.yaml -o -f newrelic.js -o -e node_modules/@sentry/node/package.json -o -e node_modules/@sentry/nextjs/package.json -o -e node_modules/dd-trace/package.json"
  - ruleId: docker-image-latest-tag
    label: Dockerfile uses :latest tag instead of pinned version
    severity: P2
    mechanism: static-grep
    source: deploy-incident/v2
    rationale: "`FROM node:latest` (or implicit `FROM node`) means every rebuild may pull a different base image — breaking reproducibility, introducing unreviewed CVEs, and making rollback impossible. Pin to a specific tag (e.g. node:24.5-alpine3.20) and update via Renovate / Dependabot."
    detection:
      pattern: "^FROM\\s+[a-zA-Z0-9_./-]+(:latest)?\\s*$"
      filePattern: "**/Dockerfile*"
    fix:
      kind: template
      command: "echo 'manual remediation required: pin Dockerfile FROM to specific tag (e.g. node:24.5-alpine3.20) and add Renovate or Dependabot config to track updates'"
      verifyCommand: "! grep -rEn '^FROM\\s+[a-zA-Z0-9_./-]+(:latest)?\\s*$' --include=Dockerfile* ."
---

# Deploy / incident readiness

Five rules covering the gap between "it runs on my laptop" and "it survives
a 3 AM outage." Catches the canonical patterns that turn small incidents
into postmortems.

## Five rules

1. **`debug-mode-in-prod-config`** — `debug: true` defaults or
   `NODE_ENV !== 'production'` checks that leak verbose data in production.
2. **`missing-health-endpoint`** — no `/health` / `/healthz` route. Load
   balancers and uptime monitors need a cheap liveness signal.
3. **`missing-incident-runbook`** — no `RUNBOOK.md` / `INCIDENT.md` /
   `DEPLOY.md` file. On-call needs a written procedure at 3 AM.
4. **`missing-monitoring-config`** — no Sentry / Datadog / New Relic /
   OpenTelemetry config. Production without monitoring is flying blind.
5. **`docker-image-latest-tag`** — Dockerfile uses `:latest` or no tag —
   non-reproducible builds and silent CVE intake.

## Remediation

```ts
// Health endpoint (Express)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    version: process.env.GIT_SHA ?? 'dev',
  });
});
```

```dockerfile
# Bad
FROM node:latest

# Good — pinned, slim
FROM node:24.5-alpine3.20
```

```ts
// Sentry init (Node)
import * as Sentry from '@sentry/node';
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
  release: process.env.GIT_SHA,
});
```

```markdown
<!-- RUNBOOK.md skeleton -->
# Runbook

## Rollback
1. `fly deploy --image registry.fly.io/myapp:<prev-sha>`
2. Verify /health returns 200 within 30s.

## Scale up
- `fly scale count 4`

## Log locations
- App logs: Fly dashboard / `fly logs`
- Errors: Sentry → project "myapp-prod"

## Page schedule
- Primary: @alice  |  Secondary: @bob  |  Escalation: @carol
```

Re-run `zerou audit` after each fix; the verify commands must exit 0.
