# Bug-patcher disconnect + auth-wall false positives — Phase 11

## TL;DR

Two production-grade breaks in the audit→enhance pipeline on `meme-weather-zerou-test`:

1. **Architectural break**: 33 "fail" verdicts from the static-analyzer judge (rich `verdictReason` + `evidence.file/line/snippet/expectedBehavior/actualBehavior`) are emitted to jsonl logs but the markdown `## Static Hardening Findings` table is empty, so `readAuditFindings` returns `[]` and bug-patcher considers zero inputs. The judge can SEE the bugs; the patcher never hears about them.
2. **Auth-wall + wrong-mock false positives**: `test-emitter` generates Vitest tests that mock the wrong module path (`@/lib/db` — the real module is `@/lib/db/client` + `@/lib/auth/server.getServerUser` over Supabase cookies). The emitted tests cannot bypass the real `getServerUser()` gate, so every assertion that expects `200` collapses into a `401`. The static judge has the same blind spot at a lesser scale: it reasons line-by-line in a ±30-line window and can't see "this endpoint is gated upstream by a helper from another file".

Recommended fix: (a) wire `TestCaseResult[]` with `status='fail'` into `readAuditFindings()` as a second source of `AuditFinding`-shaped rows; (b) extend test generator + emitter with an "auth shape" pre-scan that records framework auth helpers and emits canonical mocks; (c) on the judge side, pass the auth helper source into the prompt window so it stops marking "endpoint queries DB without auth check" when the auth gate is one helper call away.

---

## Problem 1: Bug-patcher pipeline analysis

### Current data flow

```
generateTestCases ─► TestCaseSpec[] ─► runTestCaseBatch ─► TestCaseResult[]    [in-memory, lost]
                                              │
                                              ├─► test-result-logger ─► jsonl  [rich, unread]
                                              │
                                              └─► writeAuditReport ─► .md table  [findings only,
                                                                                  NOT test fails]
                                                                          │
                                                                          ▼
                                                                readAuditFindings()
                                                                          │
                                                                          ▼
                                                                  AuditFinding[]   ← empty
                                                                          │
                                                                          ▼
                                                                       patchBugs   ← no-op
```

### Where the break is

`cli/src/enhance.ts:451-502` — `readAuditFindings()` only parses one HTML-commented section: `<!-- section:static-findings start -->…end -->`. Its inline comment even says so verbatim:

> `// For v1 we ONLY read the structured findings from the audit-report.md table.`
> `// The richer test-case results (LLM-judge fail entries) are in logs but`
> `// require parsing event streams; defer to v2.`

That deferral is the architectural break. In `meme-weather-zerou-test/.zerou/audit-report.md`, the static-findings section literally renders `_No findings._` while §6 mentions 66 tests / 33 failed. The patcher receives `[]` and `bug-patcher.ts:103-109` logs `eligible: 0`. Module C in `enhance-report.md` then says "Bugs auto-patched: 0 findings considered" — technically truthful, structurally meaningless.

The jsonl logs at `D:\lll\meme-weather-zerou-test\.zerou\logs\agent\2026-05-27\01KSM5CGZZC9VAVXB43JNB14Q7.jsonl` (and the second trace) contain 33 `event: "agent.test-run.case.complete"` lines with `status: "fail"`, e.g.:

- `specId: "get-api-graveyard-3"` — `verdictReason: "The GET handler at line 55 proceeds directly to parse pagination and query the database without any authentication check."`, `evidenceFile: app/api/graveyard/route.ts`, `evidenceLine: 55`.
- `specId: "fn-computeheadercards-2"` — `"directly accesses r.derivativeCount without null/undefined/array-element type checks"`, `app/api/memes/route.ts:156`.

These are the exact rows bug-patcher was built to consume.

### Schema gap between TestCaseResult and AuditFinding

`cli/src/agent/types.ts:113-126` defines `TestCaseResult`; `cli/src/enhance/types.ts:55-65` defines `AuditFinding`. Field-by-field gap:

| `AuditFinding`            | `TestCaseResult`                         | Bridge                                                          |
| ------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| `id`                      | `spec.id`                                | direct                                                          |
| `file`                    | `evidence.file ?? spec.scope.file`       | direct                                                          |
| `line`                    | `evidence.line ?? spec.scope.line`       | direct                                                          |
| `severity: 'P1'\|'P2'\|'P3'`| — (no severity)                          | **derive** from `spec.category`: `security`→P1, `auth`/`error-handling`→P2, others→P3 |
| `category: string`        | `spec.category`                          | map TestCaseCategory → AuditFinding category vocabulary used by `classifyFinding` (`db-injection`, `error-handling`, `auth-weakness`, …) |
| `message`                 | `spec.name`                              | direct                                                          |
| `snippet?`                | `evidence.snippet`                       | direct                                                          |
| `expectedBehavior?`       | `evidence.expectedBehavior` / `spec.then`| direct (prefer evidence)                                        |
| `actualBehavior?`         | `evidence.actualBehavior` / `verdictReason` | direct                                                       |

No truly missing data — every patcher-consumed field is recoverable. The only judgement call is the `severity` mapping (since the v1 static-analyzer judge doesn't emit a severity).

### Patchability analysis

Not all 33 test-fail categories patch cleanly. Triage by class (read across the actual jsonl `verdictReason`s):

| Class                                       | Volume | Mechanically patchable?                                                                          |
| ------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| **Unchecked nullable** (e.g. `derivativeCount`) | ~6     | YES — narrow patches, same surface area as `encodeURIComponent` hint.                            |
| **Missing auth check on read endpoint**     | ~8     | PARTIAL — patcher can insert `getServerUser()` guard if it knows the helper exists; needs auth-shape context. |
| **IDOR / authz** ("user A reads user B")    | ~4     | NO for v1 — requires per-row tenant predicate; reject with category `'authz'` (same bucket bug-patcher already skips). |
| **Race condition / TOCTOU** (TSPR-BUG-2)    | ~3     | NO — needs transactional rewrite; reject with `category: 'concurrency'`.                         |
| **Unhandled rejection / stack-trace leak**  | ~5     | YES — wrap with try/catch, return 500 JSON. Maps cleanly to existing `error-handling` eligibility. |
| **Input validation gap** (hex parseInt, etc.) | ~4   | YES — small input-coercion patch, matches `db-injection`/sanitize bucket.                        |
| **Spec mis-specified / wrong assumption**   | ~3     | N/A — judge marks `fail` but verdictReason describes the SPEC being wrong, not the code. These must be filtered out before reaching the patcher. |

Roughly 15 of 33 are immediately patchable today; 4-6 more become patchable after we land the auth-shape pre-scan (Problem 2); the remainder should be explicitly rejected by an extended `classifyFinding` (with new ineligible reasons: `'authz-needs-row-predicate-v2'`, `'concurrency-needs-tx-rewrite-v2'`, `'spec-mis-specified-v1'`).

### Recommended fix

Two-step, both on `cli/src/enhance.ts`:

1. **Read test-fail evidence alongside the markdown table.** New helper `readTestFailFindings(targetCwd)`:
   - Glob `.zerou/logs/agent/*/*.jsonl`.
   - Filter lines where `event === 'agent.test-run.case.complete'` && `status === 'fail'`.
   - Use the trace id to coalesce the spec's original `category` (also logged at `agent.test-run.case.start`).
   - Map each to `AuditFinding` per the table above.
   - Cap at N (e.g. 50) ordered by severity → recency to keep patcher loops bounded.
2. **Union with the existing findings**, de-dupe by `(file, line, message)`, then hand the merged array to `patchBugs` exactly as today.

Then extend `classifyFinding()` in `cli/src/enhance/bug-patcher.ts:55-83` with the new `authz`, `concurrency`, `spec-mis-specified` rejection reasons so the patcher's `skipped` ledger is honest and doesn't silently swallow 18 not-actually-patchable rows.

This change ships static-judge fails through the SAME safety rails (cross-file guard, tsc rollback, oversize cap, idempotency) that the static-findings table already enjoys. Net result on the meme-weather repo: ~15 patches actually attempted instead of 0.

---

## Problem 2: 401 auth-wall false positives

### What's happening

Every Next.js endpoint in the demo uses the same auth gate:

```ts
// app/api/.../route.ts
import { getServerUser } from '@/lib/auth/server';
…
const user = await getServerUser();
if (!user) return NextResponse.json({ error: 'login required' }, { status: 401 });
```

`getServerUser` calls `supabase.auth.getUser()` which reads `next/headers.cookies()`. In a vitest harness with no cookie store and no Supabase fetcher, `getUser()` returns `{ user: null }`, the gate fires, status=401, and every `expect(status).toBe(200|403|500)` fails.

Side issue compounding it: the emitter mocks the wrong module path. Look at the emitted `tests/__zerou__/app-api-memes-id-route.test.ts:18-26`:

```ts
vi.mock('@/lib/db', () => ({ db: { meme: { findUnique: vi.fn() } } }));
vi.mock('next/headers', () => ({ cookies: vi.fn(() => ({ get: vi.fn() })) }));
```

Real demo uses `@/lib/db/client` exporting `requireDb()` (not `@/lib/db.db`), and uses `next/headers.cookies()` as part of `createServerClient` from `@supabase/ssr` — mocking just `cookies()` doesn't reach the Supabase SSR client. The emitter never read the real surface. Same file also has a duplicate `import { vi } from 'vitest'` and a nested `it()` inside another `it()`, which means many tests fail to even register correctly — see `app-api-me-bets-route.test.ts:5-7` where `import { describe, it, expect, vi } from 'vitest';` immediately precedes `import { vi, describe, it, expect, beforeEach } from 'vitest';`.

### Why current generator can't handle this

In `cli/src/agent/test-case-generator.ts:509-547`, `buildSpecPrompt()` gives the LLM only a ±30-line window around the target line plus a hard-coded "attack-surface checklist". It never tells the model:

- which framework auth helper guards this endpoint (`getServerUser`, `getSession`, etc.);
- which db client function to mock (the demo's `requireDb()` not the generic `db`);
- that the test will run under vitest with no real cookie store, so an assertion of "returns 200" is **only achievable if the test mocks the auth helper to return a user**.

The judge (`test-spec-runner.ts:313-350`) has a related but distinct blind spot. Its prompt deliberately withholds `category` and `reasoning` for "information isolation" (anti-self-confirmation), then asks the judge to default to `fail`. With a 30-line window that does NOT include `getServerUser`'s definition, the judge sees `db.select().…` queries running on line N and concludes "no auth check — fail" — which is a true positive in literal terms but a false positive in product terms (the auth check is one frame up the call stack).

The emitter (`test-emitter.ts:170-189`, `buildEmitUserPrompt:470-528`) does get `FunctionInfo` if available, but `FunctionInfo` only flags `hasDatabaseCall`/`hasNetworkCall` booleans — no module path, no auth-helper presence, no canonical mock template.

### Proposal A: judge-side fix (cheap)

1. **Auth-shape pre-scan** during project profiling: extend `detectProject` (or add `agent/auth-detector.ts`) to find auth helper imports, e.g. grep for `getServerUser|createServerClient|getSession|authMiddleware|withAuth` and record:

   ```ts
   interface AuthShape {
     helperName: string;          // 'getServerUser'
     helperFile: string;          // 'lib/auth/server.ts'
     framework: 'supabase-ssr' | 'next-auth' | 'lucia' | 'custom' | null;
     usedIn: string[];            // endpoint files that import it
   }
   ```
2. **Surface to judge**: when an endpoint file lists `helperName` in its imports, append a short `AUTH CONTEXT` block to the judge user prompt:
   - "This endpoint is gated by `getServerUser()` from `lib/auth/server.ts:28-32`. If the source code begins with `await getServerUser(); if (!user) return …401`, treat the auth check as **present** even if the rest of the window assumes a user. Only return `fail` for auth concerns when the gate is missing OR after the gate."
3. **Spec post-filter**: if `then` says "returns 200" AND the endpoint is `requiresAuth` AND the spec doesn't say "with authenticated user", reclassify result as `inconclusive` with reason `'spec-omitted-auth-assumption'`. This re-routes the misframed "session-token swap" specs from the `fail` bucket to `inconclusive` (which the patcher already ignores by class).

Effort: ~1 day. Improves the static-judge signal (Problem 1 outcome) without touching emitter code paths.

### Proposal B: emitter-side fix (real)

For the emitted vitest files to actually exercise the inside of an endpoint, the emitter must:

1. **Detect auth framework** (same pre-scan as Proposal A).
2. **Emit canonical auth + db mocks per framework** as a fixture module shipped alongside `tests/__zerou__/`:

   ```
   tests/__zerou__/_fixtures/supabase-auth.ts   // exports mockAuthedUser(userId)
   tests/__zerou__/_fixtures/drizzle-db.ts      // exports mockDb({ ... })
   ```

   For Supabase-SSR specifically:
   ```ts
   vi.mock('@/lib/auth/server', () => ({
     getServerUser: vi.fn(async () => ({ id: 'test-user-1', email: 'u@test' })),
     createSupabaseServerClient: vi.fn(),
   }));
   vi.mock('@/lib/db/client', () => ({ requireDb: () => mockDb }));
   ```
3. **Per-test auth posture**: `TestCaseSpec` gains an optional `authPosture` field (`'authenticated' | 'anonymous' | 'cross-tenant'`) derived from `spec.category` and `spec.given`. The emitter selects the fixture preset accordingly. IDOR specs would use `'cross-tenant'` (fixture returns user-B from `getServerUser`, db returns user-A's row).
4. **Use real module path**: the emitter already computes `relImportPath` (`test-emitter.ts:228`); it must use that same path for the auth helper too, not hard-code `@/lib/db`. The pre-scan supplies the real path.
5. **De-duplicate imports**: trivial bug — `collectedImports` is a `Set<string>` but the LLM emits a second `import { vi } from 'vitest';` which differs only in member ordering and slips past the dedupe. Fix: tokenize each import line, sort members, then dedupe.

Effort: ~3-4 days. Yields tests that actually run and produce signal `pass`/`fail` reflecting code reality instead of the auth wall.

### Recommendation

Ship **both**. Proposal A unlocks the bug-patcher loop today (which is the immediate Phase 11 user-visible regression — Module C says "0 patches"). Proposal B is required for ZeroU's promised value of *running real tests*; without it the §6 "Test Execution Results" panel will continue to show `exit:1, pass:0, fail:0` which is worse than useless. They share the same pre-scan, so building A first and reusing its `AuthShape` for B is the natural sequence.

---

## Combined solution architecture

```
detectProject
   │
   ├─► AuthShape (new pre-scan)              ←──── shared by judge + emitter
   │
   ▼
generateTestCases ─► TestCaseSpec[] (gains authPosture)
   │
   ├─► runTestCaseBatch
   │      └─ judge prompt now includes AUTH CONTEXT block
   │      └─ post-filter: misframed-auth specs → 'inconclusive'
   │
   ▼   TestCaseResult[] ──────────────────────────────┐
                                                       │
emitVitestTests                                        │
   └─ canonical auth+db mocks injected per framework   │
   └─ dedupe imports                                   │
                                                       │
                                                       ▼
writeAuditReport
   ├─ §3 Static Hardening Findings (table)             │
   ├─ §6.5 Test Failures (NEW table — fail+evidence)   │
   └─ jsonl traces                                     │
                                                       │
                              ┌────────────────────────┘
                              ▼
                    readAuditFindings (extended)
                      ├─ parse markdown table (today)
                      └─ parse §6.5 OR jsonl events    (NEW)
                              │
                              ▼
                       AuditFinding[] (union, de-dup)
                              │
                              ▼
                          patchBugs
                            with extended classifyFinding
                            (authz / concurrency / spec-mis-spec rejects)
```

---

## Implementation sketch

Files to add / modify (no code, just shape):

- `cli/src/agent/auth-detector.ts` **NEW** — `detectAuthShape(cwd, profile): Promise<AuthShape | null>`. Greps for known helper names + imports; persists into `ProjectProfile.evidence.auth = {...}`.
- `cli/src/agent/types.ts` — extend `ProjectProfile` with optional `authShape: AuthShape | null`; extend `TestCaseSpec` with optional `authPosture`.
- `cli/src/agent/test-case-generator.ts` — `buildSpecPrompt` adds AUTH CONTEXT section when `profile.authShape` exists; `normalizeSpec` infers `authPosture` from `given` text + category.
- `cli/src/agent/test-spec-runner.ts` — `buildUserPrompt` appends AUTH CONTEXT and the auth-helper source window (read it once at batch start, not per spec); post-filter applied in `runTestCase` between `parseDecision` and `result` construction.
- `cli/src/agent/test-emitter.ts` — new helper `buildAuthMocks(profile)` returning `{ imports, mockBlock }`; injected at top of every emitted file when `authShape` non-null. Fix import dedupe (normalize before `Set.add`).
- `cli/src/agent/test-fixtures/` **NEW directory** — `supabase-ssr.ts`, `next-auth.ts`, `lucia.ts`, `custom-cookie.ts`. Emitter copies the right fixture file to `tests/__zerou__/_fixtures/` once per audit run.
- `cli/src/enhance.ts` — `readTestFailFindings(cwd)`: glob jsonl, filter `agent.test-run.case.complete` w/ `status='fail'`, map to `AuditFinding`. `readAuditFindings` unions both sources.
- `cli/src/enhance/bug-patcher.ts` — extend `classifyFinding` with `authz` (`'authz-needs-row-predicate-v2'`), `concurrency` (`'concurrency-needs-tx-rewrite-v2'`), `spec-mis-specified` (`'spec-mis-specified-v1'`); add hint for `'null-check-missing'` (mechanical patch via `?.` or guard).
- `cli/src/audit-report.ts` (or wherever the markdown writer lives) — add `<!-- section:test-failures start -->` table so the report stays the single source of truth and `readAuditFindings` could parse markdown alone without re-reading jsonl in the future.

Tests to add (every new public surface needs auto-runnable verification per CLAUDE.md):

- `cli/src/agent/auth-detector.test.ts` — fixture projects: supabase-ssr / next-auth / custom-cookie / no-auth.
- `cli/src/enhance/read-test-fail-findings.test.ts` — synthetic jsonl with mixed pass/fail/inconclusive; assert mapping and severity inference.
- `cli/src/enhance/bug-patcher.test.ts` — extend with new ineligibility cases.
- e2e smoke against a copy of `meme-weather-zerou-test` (or a stripped fixture): assert §3 table empty + §6.5 table non-empty + Module C "Bugs auto-patched: N≥10".

---

## Open questions for user

1. **Severity assignment when test-fails become findings.** Static-judge fails have no severity field. Auto-map `security`/`auth` → P1, `error-handling`/`edge-case` → P2, others → P3 by default? Or require an explicit severity-tagging step in the generator?
2. **Opt-in flag**. Should patching of test-fail-derived findings be opt-in (`zerou enhance --include-test-fails`) for v1 — defaulting OFF so users who only want the conservative "mechanical findings only" loop are not surprised? My recommendation is ON-by-default because the demo's current "0 patches" outcome is product-broken.
3. **Auth fixture maintenance**. The canonical mocks for Supabase-SSR / NextAuth / Lucia drift when those libs release breaking changes. Acceptable to pin minimum versions in `package.json` of the audited project and warn on mismatch? Or ship fixtures per minor version?
4. **Cap on test-fails fed to patcher.** Run on a 200-spec project, a 60% fail rate fills the patcher with 120 LLM round-trips × ~$0.01-0.05 each. Default cap (e.g. top 30 by severity) — acceptable?
5. **§6.5 markdown source-of-truth**. Do we want to refactor `readAuditFindings` to ALWAYS read markdown (cleaner) and treat the jsonl as the durable archive — or keep the dual path indefinitely so that `enhance` can still run on stale `.md` files when jsonl has rotated away?
6. **Spec-mis-specified bucket**. ~3 of the 33 are the generator's fault, not the code's. Should the judge be allowed to flag a spec as "ill-formed" (new status: `'rejected-spec'`) so we feed back into the generator's prompt next iteration instead of polluting the fail bucket? That's a small but meaningful loop-closing improvement orthogonal to both Problem 1 and Problem 2.
