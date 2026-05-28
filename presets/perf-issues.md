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
  - ruleId: db-n-plus-1-loop
    label: "Awaited DB lookup inside for/for-of/while loop"
    severity: P2
    mechanism: llm-judgment
    source: perf-issues/v2
    rationale: "`for (const item of items) await db.find(...)` issues N sequential round-trips. Latency is N × (1 RTT + query). LLM judgment verifies the awaited call is a DB read/write (not an awaited sleep) and that items are independent enough to batch via `findMany({ where: { id: { in: ids } } })` or DataLoader."
    detection:
      pattern: for\s*\(\s*(const|let|var)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s+of\s+[^)]+\)\s*\{[\s\S]{0,400}?await\s+[a-zA-Z_$]
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: replace per-item await with a single batched call (findMany / IN query / DataLoader). If items are truly independent, await Promise.all(items.map(work)).'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: large-json-no-pagination
    label: Endpoint returns array result without pagination / limit
    severity: P2
    mechanism: llm-judgment
    source: perf-issues/v2
    rationale: "`res.json(await db.findAll())` is fine until the table grows. With 100k rows the response is multi-MB JSON, the DB read scans the table, and the API egress cost balloons. Apply `LIMIT` + cursor / page params; or default to a sensible page size."
    detection:
      pattern: res\.(json|send)\s*\(\s*await\s+[a-zA-Z_$][a-zA-Z0-9_$.]*\.(find|findAll|findMany|select|all)\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: add ?limit / ?cursor params; default to LIMIT 100; document pagination contract in OpenAPI'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: sync-fs-in-handler
    label: Synchronous fs.*Sync call detected (blocks event loop)
    severity: P1
    mechanism: static-grep
    source: perf-issues/v2
    rationale: "`readFileSync` / `writeFileSync` inside (or reachable from) a request handler blocks the event loop, stalling every concurrent request. A 50ms blocking read becomes 50ms × concurrency tail latency. Use `fs/promises` and `await`."
    detection:
      pattern: \bfs\.(readFileSync|writeFileSync|appendFileSync|statSync|readdirSync|unlinkSync)\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: import { readFile, writeFile } from \"node:fs/promises\"; await readFile(path); — never *Sync inside a request path'"
      verifyCommand: "! grep -rE '\\bfs\\.(readFileSync|writeFileSync|appendFileSync|statSync|readdirSync|unlinkSync)\\s*\\(' src/"
  - ruleId: cpu-bound-loop-in-handler
    label: Long-running array map/filter/reduce inside request handler
    severity: P2
    mechanism: llm-judgment
    source: perf-issues/v2
    rationale: "Computing a 10k-element transform inside a handler blocks the event loop for the duration. Even O(N) work over a sufficiently large N starves other requests. Move CPU-bound work to a Worker thread / queue (`worker_threads`, BullMQ) or chunk + `setImmediate` to yield."
    detection:
      pattern: \.(post|get|put|patch|delete)\s*\([^)]+,\s*(async\s+)?\([^)]*\)\s*=>\s*\{[\s\S]{0,800}?\.(map|filter|reduce|flatMap|forEach)\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: offload to worker_threads or a job queue; or chunk via for-loop + await new Promise(r => setImmediate(r)) every N items'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: no-response-compression
    label: Express / Fastify app without compression middleware
    severity: P3
    mechanism: llm-judgment
    source: perf-issues/v2
    rationale: "Without `compression()` (Express) / `@fastify/compress` (Fastify) JSON responses are sent uncompressed. Typical 80-95% size reduction is left on the table, increasing egress cost and mobile TTFB. Add gzip / brotli compression once at app bootstrap."
    detection:
      pattern: (compression|@fastify/compress|hono/compress)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: npm i compression && app.use(compression()); or @fastify/compress / hono/compress; brotli > gzip if you can negotiate it'"
      verifyCommand: "grep -rE 'compression|@fastify/compress|hono/compress' src/"
  - ruleId: db-no-index-suggestion
    label: where().orderBy().limit() query pattern (likely needs composite index)
    severity: P3
    mechanism: llm-judgment
    source: perf-issues/v2
    rationale: "`.where({status: 'active'}).orderBy('createdAt').limit(50)` without a `(status, createdAt)` composite index forces a sort over all matching rows. Past a few thousand rows this becomes a measurable hotspot. LLM judgment verifies the table is likely large and recommends the matching composite index."
    detection:
      pattern: \.where\s*\([^)]*\)[\s\S]{0,200}\.orderBy\s*\([^)]*\)[\s\S]{0,200}\.limit\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: add composite index matching where columns + orderBy column; run EXPLAIN to verify the plan no longer sorts; document in migrations'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: memory-leak-event-listener
    label: emitter.on() / addListener() with no matching .off / .removeListener
    severity: P2
    mechanism: static-grep
    source: perf-issues/v2
    rationale: "Each `emitter.on('event', listener)` accumulates a closure-rooted listener. In a request handler that registers a listener per request without removing it, the listener array grows unbounded — EventEmitter warns at 11, then leaks until OOM. Always pair with `.off` / `.removeListener` (or use `.once`)."
    detection:
      pattern: \.(on|addListener|addEventListener)\s*\(\s*['"`][a-zA-Z_-]+['"`]
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: pair every .on(event, fn) with .off(event, fn) in a finally/cleanup; or use .once() if it should fire exactly once'"
      verifyCommand: "echo 'manual review required'"
---

# Performance hotspots

Vibe-coded apps regularly ship with five classic perf footguns that degrade
gracefully in development (small data, no concurrency) and catastrophically
in production (real traffic, real table sizes).

## Rules

1. **`n-plus-one-query`** / **`db-n-plus-1-loop`** — awaited DB call inside
   a loop. Static grep finds the loop+await pattern; LLM verdict confirms
   the awaited call is actually a DB round-trip.
2. **`sync-fs-in-request-handler`** / **`sync-fs-in-handler`** —
   `readFileSync` / `writeFileSync` block the event loop; in a request
   handler that stalls every concurrent request on the same process.
3. **`missing-rate-limit-middleware`** — no known rate-limit package in
   `node_modules`. Public endpoints without rate limiting are trivially
   DoS-able and inflate LLM / DB cost.
4. **`select-star-without-limit`** — heuristic regex for `SELECT * FROM ...`
   without a `LIMIT` clause in the same statement.
5. **`missing-query-timeout`** — any `fetch`/`axios`/`got` call should
   pair with `AbortSignal.timeout(ms)`; DB calls should configure
   `statement_timeout` / `queryTimeout`.
6. **`large-json-no-pagination`** — endpoint returns a full array result
   without `?limit` / cursor params; the table eventually outgrows the
   wire and the budget.
7. **`cpu-bound-loop-in-handler`** — long map/filter/reduce inside a
   handler blocks the event loop. Offload to worker_threads / queue.
8. **`no-response-compression`** — without `compression()` / `@fastify/compress`,
   JSON payloads ship uncompressed.
9. **`db-no-index-suggestion`** — `.where(...).orderBy(...).limit(...)`
   without a matching composite index forces sort-over-all-rows.
10. **`memory-leak-event-listener`** — `.on(...)` without matching `.off`
    accumulates closures and OOMs the process.

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
