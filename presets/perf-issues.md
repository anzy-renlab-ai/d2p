---
id: perf-issues
version: 2
name: Performance hotspots (vibe-coded apps)
appliesTo: []
rules:
  - ruleId: n-plus-one-query
    label: N+1 query pattern — awaited DB call inside a loop
    severity: P2
    mechanism: llm-judgment
    source: perf-issues/v2
    rationale: "Calling `await db.findOne` / `await prisma.x.findUnique` inside a for/for-of/map loop issues one round-trip per element. Replace with batched `findMany({ where: { id: { in: ids } } })` or DataLoader. The grep is a heuristic; LLM judgment confirms the loop body actually awaits a DB call."
    detection:
      pattern: "for\\s*\\([^)]*\\)\\s*\\{[^}]*await\\s+(db|prisma|knex|sequelize|mongoose|supabase)\\."
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation required: batch the awaited DB calls into a single findMany / IN query, or hoist with Promise.all when independent'"
      verifyCommand: "! grep -rEn 'for\\s*\\([^)]*\\)\\s*\\{[^}]*await\\s+(db|prisma|knex|sequelize|mongoose|supabase)\\.' src/"
  - ruleId: sync-fs-in-request-handler
    label: Synchronous fs.readFileSync / writeFileSync detected
    severity: P2
    mechanism: static-grep
    source: perf-issues/v2
    rationale: "Synchronous fs calls block the Node.js event loop. Inside an HTTP request handler this starves all concurrent requests on the same process. Use `fs/promises` (`await readFile`) or stream the file."
    detection:
      pattern: "(readFileSync|writeFileSync|appendFileSync|existsSync)\\s*\\("
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation required: switch to fs/promises and await; or move the read to module init if the file never changes'"
      verifyCommand: "! grep -rEn '(readFileSync|writeFileSync|appendFileSync)\\s*\\(' src/"
  - ruleId: missing-rate-limit-middleware
    label: No rate-limit middleware installed
    severity: P2
    mechanism: file-exists
    source: perf-issues/v2
    rationale: "Public HTTP endpoints without rate limiting are trivially DoS-able and rack up LLM/database cost. Install `express-rate-limit`, `@fastify/rate-limit`, `@upstash/ratelimit`, or `hono-rate-limiter` and apply globally before route handlers."
    detection:
      paths:
        - node_modules/express-rate-limit/package.json
        - node_modules/@fastify/rate-limit/package.json
        - node_modules/@upstash/ratelimit/package.json
        - node_modules/hono-rate-limiter/package.json
        - node_modules/koa-ratelimit/package.json
      expect: present
    fix:
      kind: template
      command: "echo 'manual remediation required: npm install express-rate-limit (or platform equivalent) and wire it before route handlers'"
      verifyCommand: "test -e node_modules/express-rate-limit/package.json -o -e node_modules/@fastify/rate-limit/package.json -o -e node_modules/@upstash/ratelimit/package.json -o -e node_modules/hono-rate-limiter/package.json"
  - ruleId: select-star-without-limit
    label: SELECT * query without LIMIT clause
    severity: P3
    mechanism: static-grep
    source: perf-issues/v2
    rationale: "`SELECT *` returns every column of every row. Without `LIMIT`, a growing table linearly slows the query and the API response. Project only required columns and add a hard `LIMIT` ceiling."
    detection:
      pattern: "SELECT\\s+\\*\\s+FROM\\s+[a-zA-Z_][a-zA-Z0-9_\\.]*"
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs,sql}
    fix:
      kind: llm-only
      command: "echo 'manual remediation required: replace SELECT * with explicit columns and add LIMIT N to bound the result set'"
      verifyCommand: "! grep -rEn 'SELECT\\s+\\*\\s+FROM' src/ | grep -v LIMIT"
  - ruleId: missing-query-timeout
    label: DB / HTTP call without explicit timeout
    severity: P3
    mechanism: llm-judgment
    source: perf-issues/v2
    rationale: "A hung DB query or upstream HTTP call without a timeout holds a request slot indefinitely, draining the connection pool. Configure `statement_timeout` (Postgres), per-query timeouts (Prisma transactionOptions), or `AbortSignal.timeout(ms)` on fetch."
    detection:
      pattern: "(fetch|axios|got|request)\\s*\\("
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation required: add AbortSignal.timeout(ms) to fetch calls and statement_timeout / pool.query timeout to DB calls'"
      verifyCommand: "grep -rEn 'AbortSignal\\.timeout|statement_timeout|queryTimeout|connectTimeout' src/"
---

# Performance hotspots

Vibe-coded apps regularly ship with five classic perf footguns that degrade
gracefully in development (small data, no concurrency) and catastrophically
in production (real traffic, real table sizes).

## Five rules

1. **`n-plus-one-query`** — awaited DB call inside a loop. Static grep
   finds the loop+await pattern; LLM verdict confirms the awaited call is
   actually a DB round-trip and not, say, an awaited timer.
2. **`sync-fs-in-request-handler`** — `readFileSync` / `writeFileSync` in
   source files. These block the event loop; in a request handler that
   stalls every concurrent request on the same process.
3. **`missing-rate-limit-middleware`** — no known rate-limit package in
   `node_modules`. Public endpoints without rate limiting are trivially
   DoS-able and inflate LLM / DB cost.
4. **`select-star-without-limit`** — heuristic regex for `SELECT * FROM ...`
   without a `LIMIT` clause in the same statement.
5. **`missing-query-timeout`** — LLM-judged: any `fetch`/`axios`/`got` call
   should pair with `AbortSignal.timeout(ms)`; DB calls should configure
   `statement_timeout` / `queryTimeout`.

## Remediation

```ts
// Bad: N+1
for (const id of ids) {
  const u = await db.user.findUnique({ where: { id } });
  results.push(u);
}

// Good: single round-trip
const users = await db.user.findMany({ where: { id: { in: ids } } });
```

```ts
// Bad: blocks event loop
import { readFileSync } from 'node:fs';
app.get('/template', (req, res) => res.send(readFileSync('./tpl.html')));

// Good: async + cached
import { readFile } from 'node:fs/promises';
const tpl = await readFile('./tpl.html', 'utf8');     // at module init
app.get('/template', (_, res) => res.send(tpl));
```

```ts
// Rate limit (Express)
import rateLimit from 'express-rate-limit';
app.use(rateLimit({ windowMs: 60_000, max: 60 }));
```

```ts
// Query timeout
const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
// Postgres
await pool.query({ text: 'SELECT ...', values: [], statement_timeout: 2_000 });
```

Re-run `zerou audit` after each fix; the verify commands above must exit 0.
