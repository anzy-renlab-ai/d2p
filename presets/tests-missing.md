---
id: tests-missing
version: 2
name: Missing test coverage check
appliesTo: []
rules:
  - ruleId: no-test-directory-or-files
    label: No test directory or test files present
    severity: P1
    mechanism: file-exists
    source: tests-missing/v2
    rationale: A repo with zero tests has no safety net for refactors, no documentation of intended behaviour, and no CI signal. Even one smoke test catches the most common regressions (boot failure, missing env var). This rule flags the complete absence of any conventional test location.
    detection:
      paths:
        - tests
        - test
        - __tests__
        - src/__tests__
      expect: at-least-one
    fix:
      kind: template
      command: "echo 'manual remediation: mkdir tests && add at minimum one smoke test that boots the app and asserts /health returns 200'"
      verifyCommand: "test -d tests || test -d test || test -d __tests__ || test -d src/__tests__"
  - ruleId: no-test-file-extension-anywhere
    label: No *.test.* or *.spec.* file in the repo
    severity: P1
    mechanism: static-grep
    source: tests-missing/v2
    rationale: Even when a `tests/` directory exists, projects sometimes leave it empty after deleting failing tests. This rule scans source for any file matching the conventional test-file naming patterns.
    detection:
      pattern: \.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$
      filePattern: '**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: template
      command: "echo 'manual remediation: add at least one *.test.ts smoke test — start small, even a single assert(2 + 2 === 4) proves the test runner is wired up'"
      verifyCommand: "find . -path ./node_modules -prune -o -name '*.test.*' -print -o -name '*.spec.*' -print | grep -v node_modules | head -1"
  - ruleId: package-json-no-test-script
    label: package.json scripts.test missing or no-op
    severity: P2
    mechanism: static-grep
    source: tests-missing/v2
    rationale: CI and contributors look at `npm test` to verify a change. If `scripts.test` is absent, set to `echo no tests`, or points at the npm-init default (`exit 1`), the project effectively has no test command. This rule flags those placeholder values.
    detection:
      pattern: '"test"\s*:\s*"(echo[^"]*no test|exit 1|)"'
      filePattern: package.json
    fix:
      kind: template
      command: "echo 'manual remediation: set scripts.test to your runner — e.g. \"test\": \"vitest run\" or \"jest\"'"
      verifyCommand: "! grep -E '\"test\"\\s*:\\s*\"(echo[^\"]*no test|exit 1|)\"' package.json"
  - ruleId: real-credentials-in-test-fixtures
    label: Test fixtures contain real-looking credentials (not placeholders)
    severity: P2
    mechanism: llm-judgment
    source: tests-missing/v2
    rationale: Tests should use placeholder credentials like `password: 'test123'` or `sk_test_*` keys. Real-looking secrets (long random strings, `sk_live_*`, JWT tokens with real signatures) in fixtures usually mean someone copy-pasted production data — which then leaks into git history and CI logs.
    detection:
      pattern: (password|secret|token|api_?key|apiKey)\s*[:=]\s*['"][A-Za-z0-9_\-+/=]{20,}['"]
      filePattern: '**/*.{test,spec,fixture,fixtures}.{ts,tsx,js,jsx,mjs,cjs,json}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: replace fixture secrets with obvious placeholders (test-secret-do-not-use-in-prod, sk_test_*) or load from process.env in setup'"
      verifyCommand: "echo 'manual review required to distinguish placeholders from real secrets'"
  - ruleId: critical-endpoint-without-test
    label: Critical endpoint file has no sibling test file
    severity: P2
    mechanism: llm-judgment
    source: tests-missing/v2
    rationale: Auth, billing, and write endpoints are the highest-value targets — they should be the first things to ship with tests. This heuristic flags endpoints (src/api/login.ts, src/routes/checkout.ts, etc.) that have no corresponding test file.
    detection:
      pattern: src/(api|routes|controllers)/(login|signup|auth|checkout|payment|billing|admin|user)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: for each critical endpoint, add a sibling *.test.ts — start with happy path (200) + one auth failure (401)'"
      verifyCommand: "echo 'manual review required'"
---

# Missing test coverage check

Tests are the difference between "I think this works" and "this works".
Vibe-coded apps typically ship with zero tests and accumulate regressions
silently. This preset surfaces five graduated signals:

1. **`no-test-directory-or-files`** — total absence of test conventions.
2. **`no-test-file-extension-anywhere`** — directory exists but no
   `*.test.*` / `*.spec.*` file.
3. **`package-json-no-test-script`** — `scripts.test` set to the npm-init
   placeholder (`exit 1`, `echo no tests`).
4. **`real-credentials-in-test-fixtures`** — fixtures contain long random
   secret-looking values that should be placeholders.
5. **`critical-endpoint-without-test`** — auth / billing / write endpoints
   shipped with no sibling test file.

## Remediation

### Get to one test

```js
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest';
import { app } from '../src/app.js';
import request from 'supertest';

describe('smoke', () => {
  it('boots and serves /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
```

### Wire `npm test`

```json
{
  "scripts": {
    "test": "vitest run"
  }
}
```

### Placeholder secrets in fixtures

```js
// Bad
{ password: 'aB3kdK29sjLs39skdjALsx' }

// Good
{ password: 'test-pw-do-not-use-in-prod' }
// or
{ password: process.env.TEST_PASSWORD ?? 'placeholder' }
```

After applying fixes, re-run `zerou audit` and confirm zero findings remain.
