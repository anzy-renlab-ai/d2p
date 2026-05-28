# Phase 11.3 — Bug-Patcher Disconnect + Auth-Aware Test Emit

> Two production-grade breaks discovered on the `meme-weather-zerou-test`
> dogfood: bug-patcher saw 0 findings even though the judge had emitted 33
> test-case fails; and every emitted test ran anonymous against a
> Supabase-SSR app, collapsing all assertions into 401s.

---

## Goal

Per `docs/reviews/2026-05-27-bug-patcher-and-auth-wall.md`:

**Problem 1 (architectural disconnect).** `readAuditFindings()` in
`cli/src/enhance.ts:451-502` only parsed the `## Static Hardening Findings`
markdown section, with an inline comment "defer to v2" for the richer
test-case fail rows. On `meme-weather` the static section literally said
"_No findings._" while §6 reported 66 tests / 33 failed. Bug-patcher
received `[]` and logged `eligible: 0`.

**Problem 2 (auth-wall false positives).** `test-emitter` mocked `@/lib/db`
but never mocked `@/lib/auth/server.getServerUser` (the Supabase-SSR cookie
gate). Every endpoint test returned 401, every assertion expecting 200
failed. The judge also had the same blind spot at a smaller scale (±30 line
window can't see "auth helper called upstream").

Phase 11.3 wires test-case fails into the patcher input AND teaches the
emitter, generator, and judge to be auth-aware.

## Non-Goals

- ❌ No new test framework support (still Vitest only)
- ❌ No general-purpose mock generator — auth helpers are a hardcoded list
  (Supabase-SSR + NextAuth) with explicit `'none'` fallback
- ❌ No IDOR / authz patch templates (still flagged + skipped)
- ❌ No transactional / race-condition patch templates
- ❌ No compiler-API analysis; auth detection stays heuristic

## Architecture

```
cli/src/agent/auth-detector.ts        AuthShape detection
cli/src/agent/auth-fixtures.ts        canonical fixture templates
cli/src/enhance/test-fail-to-finding.ts   TestCaseResult[] → AuditFinding[]

cli/src/audit.ts                      detectAuthShape() → threaded through
                                      generator → runner → emitter; persists
                                      .zerou/test-results.json
cli/src/enhance.ts                    readAuditFindings + readTestFailFindings
                                      → unioned input to patchBugs
```

## Module Contracts

**`agent/auth-detector.ts`**

```typescript
export type AuthShape =
  | { kind: 'supabase-ssr'; helperImport: string }
  | { kind: 'next-auth'; sessionImport: string }
  | { kind: 'none' };

export function detectAuthShape(opts: {
  cwd: string;
  packageJson: PackageJsonShape;
  logger: TrackLogger;
}): Promise<AuthShape>;
```

- Heuristic: package.json deps + grep for known helper imports.
- Conservative: when ambiguous → `'none'`.

**`agent/auth-fixtures.ts`**

```typescript
export function buildAuthFixture(shape: AuthShape): {
  imports: string[];     // import lines for the test file
  mocks: string[];       // vi.mock(...) blocks
  helpers: string[];     // mockAuthenticatedUser / mockAnonymous / resetAuth
};
```

- Returns canonical templates per shape; empty `{}` for `'none'`.

**`enhance/test-fail-to-finding.ts`**

```typescript
export function testFailToFinding(r: TestCaseResult): AuditFinding | null;

// Severity mapping:
//   security / auth         → P1
//   validation / errors     → P2
//   edge-case / other       → P3
```

- Reads `.zerou/test-results.json` (written by audit).
- Returns `null` for inconclusive / pass.
- Bridges 9 fields per `bug-patcher-and-auth-wall.md` schema table.

## Acceptance Checklist

1. `audit.ts` persists `.zerou/test-results.json` after the runner batch.
2. `enhance.ts` reads test-results and unions them into `AuditFinding[]`.
3. Generator + runner + emitter receive `authShape` and use it in prompts
   + emitted mocks.
4. Not doing: IDOR patches, race-condition rewrites, framework expansion.
5. Done when `meme-weather-zerou-test` dogfood patches at least one
   "unchecked nullable" bug from the test-fail stream AND emitted tests no
   longer fail with anonymous-401 across the board.

## How To Verify

```bash
cd D:/lll/d2p/cli
npx vitest run src/agent/auth-detector.test.ts \
                src/agent/auth-fixtures.test.ts \
                src/enhance/test-fail-to-finding.test.ts

# E2E (requires MiniMax key + meme-weather fixture):
node cli/bin/zerou.mjs audit ./meme-weather-zerou-test \
  --config /tmp/zerou-minimax-cfg.json
node cli/bin/zerou.mjs enhance ./meme-weather-zerou-test
grep "test-fail" ./meme-weather-zerou-test/.zerou/enhance-report.md
```

## Implementation

- Worker dispatch: 3 parallel sonnet workers (auth-detector / fixtures /
  test-fail-to-finding are independent files).
- Follow-up commit `c24c837` replaced one CommonJS `require()` slip with
  ESM `import` (Phase 11.3 P0).
- Files changed: `audit.ts`, `enhance.ts`, `test-case-generator.ts`,
  `test-spec-runner.ts`, `test-emitter.ts`, plus three new modules.
- Test-emitter additionally gains an `ImportTracker` class to dedupe imports
  across spec batches (collateral cleanup; called out in commit message).

## Status

```
Shipped: b6bdb0a + c24c837 (P0 ESM fix)
Tests: +3 modules with hermetic test suites; 0 regression
Dogfood: meme-weather-zerou-test — test-fail findings now reach the patcher
```
