---
id: async-pitfalls
version: 2
name: Async / Promise pitfalls (vibe-coded apps)
appliesTo: []
rules:
  - ruleId: floating-promise
    label: Async call invoked as a statement without await / then / catch
    severity: P2
    mechanism: static-grep
    source: async-pitfalls/v2
    rationale: "`fetchData()` on its own line (no await, no `.then`, no `.catch`, no assignment) becomes a floating promise. Rejections surface as `unhandledRejection` and the caller proceeds as if it succeeded. Either await it, assign it, or chain `.catch`."
    detection:
      pattern: ^[\t ]+(await\s+)?(?:[a-zA-Z_$][a-zA-Z0-9_$]*\.)?(fetch|axios|request|save|update|delete|insert|create|send|publish|emit|enqueue|notify|invalidate)\s*\([^)]*\)\s*;?\s*$
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: await the call, or attach .catch(err => logger.error({err}, \"context\")); never let a promise float'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: async-foreach
    label: Array.forEach called with an async callback (forEach ignores awaits)
    severity: P2
    mechanism: static-grep
    source: async-pitfalls/v2
    rationale: "`[1,2,3].forEach(async (x) => await save(x))` schedules three save() calls in parallel and then returns immediately — forEach does not await its callback. The next statement runs before any save resolves, and rejections silently disappear. Use `for...of` with await for sequential, or `Promise.all(arr.map(async ...))` for parallel."
    detection:
      pattern: \.forEach\s*\(\s*async\s*[\(a-zA-Z_]
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace forEach(async) with for...of + await (sequential) or Promise.all(arr.map(async)) (parallel)'"
      verifyCommand: "! grep -rE '\\.forEach\\s*\\(\\s*async\\s*[\\(a-zA-Z_]' src/"
  - ruleId: promise-all-no-error-handling
    label: Promise.all / Promise.allSettled used without try/catch or .catch
    severity: P2
    mechanism: static-grep
    source: async-pitfalls/v2
    rationale: "`Promise.all` rejects as soon as any input rejects. Without `try`/`catch` (or trailing `.catch`) the rejection escapes the function, often as an unhandledRejection that crashes the process. Either await inside try/catch or attach a .catch immediately."
    detection:
      pattern: (?<!\.catch\s*\([^)]*\)\s*)(?<!try\s*\{[\s\S]{0,500})Promise\.(all|allSettled|race|any)\s*\([^)]*\)(?!\s*\.catch)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: wrap Promise.all in try/catch, or attach .catch((e) => logger.error({err: e})); for partial success use Promise.allSettled and inspect results.status'"
      verifyCommand: "echo 'manual review required — regex is approximate, inspect each hit'"
  - ruleId: await-in-loop
    label: Sequential await inside a for/while loop (consider Promise.all)
    severity: P3
    mechanism: llm-judgment
    source: async-pitfalls/v2
    rationale: "`for (const x of arr) await work(x)` serialises N calls and is O(N) latency. If the work items are independent (no shared state, ordering does not matter) batching with `Promise.all(arr.map(work))` cuts latency to O(1). LLM judgment verifies whether ordering / rate-limit constraints actually require sequencing."
    detection:
      pattern: for\s*\([^)]*\)\s*\{[\s\S]{0,200}?await\s+[a-zA-Z_$]
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: if items are independent, await Promise.all(arr.map(async (x) => work(x))); if not, document why sequential is required'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: mutex-missing-on-shared-state
    label: Module-level mutable state mutated from request handler (no lock)
    severity: P2
    mechanism: llm-judgment
    source: async-pitfalls/v2
    rationale: "Node serves multiple concurrent requests on a single event loop. A module-level `let counter = 0; ... counter += 1` mutated between awaits in a handler is a data race: handler A reads, A awaits, B reads (stale), A writes, B writes (lost). LLM judgment confirms the closure variable is reachable from a handler and lacks any mutex / atomic primitive."
    detection:
      pattern: ^(let|var)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: move shared state to a database (atomic increment), Redis (INCR), or guard with async-mutex / proper-lockfile'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: settimeout-with-await
    label: await setTimeout(...) — setTimeout returns a Timeout, not a Promise
    severity: P2
    mechanism: static-grep
    source: async-pitfalls/v2
    rationale: "`await setTimeout(() => …, 1000)` resolves to the Timeout object **immediately** — it does not pause. The body of the callback runs later, after the awaiting code has already moved on. Use `await new Promise(r => setTimeout(r, 1000))` or `import { setTimeout } from 'node:timers/promises'`."
    detection:
      pattern: await\s+setTimeout\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace with await new Promise(r => setTimeout(r, ms)) or import { setTimeout } from \"node:timers/promises\"; await setTimeout(ms)'"
      verifyCommand: "! grep -rE 'await\\s+setTimeout\\s*\\(' src/"
---

# Async / Promise pitfalls

Six concurrency footguns that pass dev (single user, no race window) and
break in production (real concurrency, real latency variance).

1. **`floating-promise`** — async call as a bare statement; rejections
   vanish, control flow proceeds before the work finishes.
2. **`async-foreach`** — `[…].forEach(async …)` does not await; iteration
   ends before any callback resolves.
3. **`promise-all-no-error-handling`** — `Promise.all` without try/catch
   or trailing `.catch`; rejection escapes as unhandledRejection.
4. **`await-in-loop`** — serialised awaits that could be `Promise.all`
   when items are independent (LLM verdicts whether ordering matters).
5. **`mutex-missing-on-shared-state`** — module-level mutable state
   touched by handlers without a lock; races corrupt the counter.
6. **`settimeout-with-await`** — `await setTimeout(...)` does not pause;
   use `node:timers/promises` or wrap in a Promise.

## Remediation patterns

```ts
// Parallel iteration with errors
const results = await Promise.all(
  items.map(async (it) => work(it)),
).catch((e) => {
  logger.error({ err: e }, 'batch failed');
  throw e;
});
```

```ts
// Sequential iteration with errors
for (const it of items) {
  try { await work(it); }
  catch (e) { logger.error({ err: e, item: it }); }
}
```

```ts
// Sleep correctly
import { setTimeout as sleep } from 'node:timers/promises';
await sleep(1_000);
```

```ts
// Atomic counter — push state into the database
await db.execute('UPDATE counters SET n = n + 1 WHERE k = ?', [key]);
```

After applying fixes, re-run `zerou audit` and confirm zero findings remain.
