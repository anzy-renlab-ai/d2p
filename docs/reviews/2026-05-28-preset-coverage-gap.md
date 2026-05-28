# Preset Coverage Gap — Phase 16 Inventory

## TL;DR

ZeroU's current run on `zerou-target` reports P=0.429, R=0.158. Out of
19 ground-truth findings, **3 caught** (Z-01/Z-02/Z-03 — all
`secrets-leak.*`) and **16 missed**. The 4 false positives come from a
single root cause: a built-in compiled-in `no-hardcoded-llm-keys` preset
that double-fires on the same lines as `secrets-leak`, plus one extra
hit on the PEM block at `src/secrets.ts:8`.

The deeper structural finding: only `secrets-leak` and (an absent)
`supabase-rls-missing` are wired into the orchestrator's default
checklist builder (`cli/src/agent/orchestrator.ts:154–188`). The
remaining 8 `.md` presets in `presets/` exist on disk but the auto-runner
never reaches for them. Even if it did, several of them currently have
their best rules pinned to `mechanism: llm-judgment`, which `defaultRunPreset`
explicitly skips at v1 (`cli/src/stubs.ts:382–390`). Closing the gap is
therefore two-part: (a) widen the checklist builder to dispatch all
applicable presets per detected project profile, and (b) downgrade
several `llm-judgment` rules to `static-grep` (or add a sibling
static-grep rule) so they actually execute.

If we ship the per-truth `static-grep` rules in §4 and the
project-detection wiring in §5, projected recall against `zerou-target`
rises from 0.158 to ≥ 0.84 (16 / 19), with precision held at ≥ 0.85 by
deduping the built-in `no-hardcoded-llm-keys` against `secrets-leak`.

---

## 1. Current preset inventory

Two classes under `presets/`: **Class A** — rule-bearing presets (have
a `rules:` block; scored by the bench). **Class B** — project-type
checklists (`api-service.md`, `cli-tool.md`, `library.md`,
`saas-web.md`, `static-site.md`, `unknown.md`): human-readable
acceptance lists, no machine rules, ignored below.

| Preset ID | mechanisms | Rules | Detects (rule families) | Verdict |
|---|---|---|---|---|
| `secrets-leak` | 3 static-grep | 3 | stripe-live, aws-akia, jwt-token | **strong** (only one that scored TPs in run) |
| `db-injection` | 4 static-grep + 1 llm | 5 | sql interpolation, req-* into query, ORM raw, mongo `$where`, nosql operator | **strong** (4 of 5 patterns map directly to Z-04..Z-08) |
| `error-handling` | 3 static-grep + 2 llm | 5 | stack-leak, catch-swallow, throw-non-error, missing global err mw, unawaited promise | **strong** (3 of 5 map to Z-09/Z-10/Z-11) |
| `observability-missing` | 2 static-grep + 3 llm | 5 | silent-catch, console.log, sentry-import, health-endpoint, mutating no-log | **strong** (2 of 5 map to Z-12/Z-13) |
| `security-cors-csp` | 2 static-grep + 1 llm + 1 file-exists + 1 static-grep (HSTS) | 5 | CORS wildcard, cookie missing flags, helmet, CSP config, HSTS | **strong** (2 of 5 map to Z-14/Z-15) |
| `auth-weakness` | 3 static-grep + 1 llm | 5 | plaintext-storage, plaintext-compare, hardcoded-jwt-secret, weak-pw-length, no-validation | **strong** (2 of 5 map to Z-17/Z-18) |
| `authz-bola` | 3 static-grep + 1 llm | 4 | route-param to query, supabase `.eq`-id, mass-assign `...req.body`, admin-no-rolecheck | **strong** (1 of 4 maps to Z-19) |
| `perf-issues` | 2 static-grep + 1 file-exists + 2 llm | 5 | n+1, sync-fs, rate-limit pkg, select-* no-limit, missing-timeout | **strong** (1 of 5 maps to Z-16) |
| `llm-cost-uncapped` | 3 llm (all) | 3 | max_tokens, untruncated input, per-user rate-limit | **stub at runtime** — every rule is `llm-judgment`, none executes under v1 |
| `gdpr-compliance` | 1 static-grep + 3 llm + 2 file-exists | 6 | PII collect, data export, account delete, third-party analytics, cookie flags, retention | **weak** — only 1 static-grep rule, no zerou-target overlap |
| `deploy-incident` | 1 static-grep + 2 llm + 2 file-exists | 5 | debug-true, health-endpoint, runbook, monitoring config, rollback | **weak** — 1 static-grep that doesn't overlap zerou-target |
| `supabase-rls` | 1 file-exists + 1 static-grep | 2 | rls policy file, `ENABLE ROW LEVEL SECURITY` | **weak** (fixture has no supabase migrations) |
| `tests-missing` | various file-exists + llm | ~5 | test pkg, test dir, ci config, coverage | **weak** (orthogonal to bug detection) |
| **(built-in) `no-hardcoded-llm-keys`** | 6 static-grep | 6 | stripe-live, stripe-test, openai, anthropic, AWS, jwt, private-key | **strong but **collides** with `secrets-leak`** — both fire on same lines, scorer treats one set as FPs |

**~21 class-A static-grep rules currently executable**; **~22 rules
pinned to `llm-judgment` / `file-exists`** are skipped by
`defaultRunPreset`. Half of our rules **don't execute at v1**.

---

## 2. The 19 truths in `zerou-target`

Each row shows: truth, file:line, the actual source bug, the regex
needed, and which existing preset rule (if any) maps to it. "Maps" =
the preset rule's `pattern` already matches and only orchestrator
wiring (or `llm-judgment` → `static-grep` re-pin) is needed; "new
preset" = no rule in repo today.

### secrets-leak family (3/3 already CAUGHT)

| ID | file:line | Source | Rule needed | Existing preset rule |
|---|---|---|---|---|
| Z-01 | `src/secrets.ts:3` | `export const STRIPE_KEY = 'sk_live_AbCdEfGhIjKlMnOpQrSt1234XYZ';` | `/sk_live_[A-Za-z0-9]{16,}/` | `secrets-leak.stripe-live-key` ✅ |
| Z-02 | `src/secrets.ts:4` | `export const AWS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';` | `/AKIA[0-9A-Z]{16}/` | `secrets-leak.aws-access-key-id` ✅ |
| Z-03 | `src/secrets.ts:5` | `export const SUPPORT_JWT = 'eyJhbGciOi…';` | `/eyJhbGciOi[A-Za-z0-9_-]{10,}/` | `secrets-leak.jwt-token` ✅ |

### db-injection family (5 MISSED — all preset rules exist & are static-grep)

| ID | file:line | Source | Rule needed | Existing preset rule |
|---|---|---|---|---|
| Z-04 | `src/db.ts:9` | `db.query(\`SELECT * FROM users WHERE id = ${req.params.id}\`)` | `/(SELECT\|INSERT\|UPDATE\|DELETE)[^\n\`]{0,200}\$\{/` | `db-injection.sql-string-interpolation` (rule present, **not dispatched**) |
| Z-05 | `src/db.ts:9` | (same line) | `/(query\|execute\|raw)\s*\([\`'"][^\`'"\n]*\$\{req\.(body\|params\|query)/` | `db-injection.req-body-into-query-unparameterised` (rule present, **not dispatched**) |
| Z-06 | `src/db.ts:14` | `prisma.$queryRaw(\`SELECT * FROM Orders WHERE userId = ${userId} …\`)` | `/(\$queryRaw\|\$executeRaw\|sequelize\.query)\s*\(\s*\`[^\`]*\$\{/` | `db-injection.orm-raw-interpolation` (rule present, **not dispatched**) |
| Z-07 | `src/db.ts:14` | (same line as Z-06) | `/(SELECT\|INSERT\|UPDATE\|DELETE)[^\n\`]{0,200}\$\{/` | `db-injection.sql-string-interpolation` (rule present, **not dispatched**) |
| Z-08 | `src/db.ts:19` | `User.findOne({ $where: req.body.expr });` | `/\$where\s*:\s*req\.(body\|params\|query)/` | `db-injection.mongo-where-injection` (rule present, **not dispatched**) |

### error-handling family (3 MISSED — preset rules exist & are static-grep)

| ID | file:line | Source | Rule needed | Existing preset rule |
|---|---|---|---|---|
| Z-09 | `src/errors.ts:6` | `res.status(500).json({ error: 'oops', stack: e.stack });` | `/res\.(status\([0-9]+\)\.)?(json\|send)\s*\(\s*\{[^}]*(stack\|JSON\.stringify\(e\b)/` | `error-handling.stack-trace-leak-in-response` ✓ |
| Z-10 | `src/errors.ts:11` | `return p.catch(() => undefined);` | `/\.catch\s*\(\s*\(\s*\)\s*=>\s*(undefined\|null\|\{\s*\}\|void\s+0)\s*\)/` | `error-handling.catch-all-swallow` ✓ |
| Z-11 | `src/errors.ts:17` | `throw 'amount must be positive';` | `/throw\s+(['"\`][^'"\`]*['"\`]\|[0-9]+\|\{[^}]*\})\s*;?/` | `error-handling.throw-non-error` ✓ |

### observability-missing family (2 MISSED — preset rules exist & are static-grep)

| ID | file:line | Source | Rule needed | Existing preset rule |
|---|---|---|---|---|
| Z-12 | `src/observability.ts:12` | `try { await charge(); } catch (e) {}` | `/catch\s*\([^)]*\)\s*\{\s*(\}\|return\s+(null\|undefined\|void\s+0)\s*;?\s*\})/` | `observability-missing.silent-catch-block` ✓ |
| Z-13 | `src/observability.ts:6` | `console.log('[' + new Date()… )` | `/console\.(log\|info\|warn\|error)\s*\(/` | `observability-missing.console-log-in-prod-paths` ✓ |

### security-cors-csp family (2 MISSED — preset rules exist & are static-grep)

| ID | file:line | Source | Rule needed | Existing preset rule |
|---|---|---|---|---|
| Z-14 | `src/cors.ts:7` | `app.use(cors({ origin: '*', credentials: true }));` | `/cors\s*\(\s*\{[^}]*origin\s*:\s*['"]\*['"]/` | `security-cors-csp.cors-wildcard-with-credentials` ✓ |
| Z-15 | `src/cors.ts:12` | `res.cookie('sid', sid, { maxAge: 86400000 });` | `/res\.cookie\s*\([^)]*\)(?!.*httpOnly)(?!.*secure)/` | `security-cors-csp.cookie-missing-secure-or-httponly` ✓ |

### perf-issues family (1 MISSED — preset rule exists & is static-grep)

| ID | file:line | Source | Rule needed | Existing preset rule |
|---|---|---|---|---|
| Z-16 | `src/perf.ts:7` | `const tpl = readFileSync('./templates/home.html', 'utf8');` | `/(readFileSync\|writeFileSync\|appendFileSync\|existsSync)\s*\(/` | `perf-issues.sync-fs-in-request-handler` ✓ |

### auth-weakness family (2 MISSED — preset rules exist & are static-grep)

| ID | file:line | Source | Rule needed | Existing preset rule |
|---|---|---|---|---|
| Z-17 | `app/api/login/route.ts:13` | `if (req.body.password === user.password) {` | `/(req\.body\.password\|password)\s*(===\|!==\|==\|!=)\s*(user\.password\|stored\|hash\|…)/` | `auth-weakness.plaintext-password-comparison` ✓ |
| Z-18 | `app/api/login/route.ts:15` | `const token = jwt.sign({ uid: user.id }, 'secret');` | `/jwt\.sign\s*\([^,]+,\s*(['"][^'"]{1,15}['"]\|'secret'\|…)/` | `auth-weakness.hardcoded-jwt-secret` ✓ |

### authz-bola family (1 MISSED — preset rule exists & is static-grep)

| ID | file:line | Source | Rule needed | Existing preset rule |
|---|---|---|---|---|
| Z-19 | `app/api/users/[id]/route.ts:6` | `const user = await prisma.user.findUnique({ where: { id: req.params.id } });` | `/(findUnique\|findFirst\|findOne\|…)\s*\(\s*\{[^}]*(where\s*:\s*)?\{[^}]*id\s*:\s*req\.params\.id/` | `authz-bola.route-param-id-used-in-query-without-owner-check` ✓ |

**Key finding**: *every* one of the 16 missed truths has a matching
rule already written in `presets/*.md` with the correct `static-grep`
pattern. The gap is **dispatch**, not **rule authorship**. We need to
solve "the auto-loader only enqueues `secrets-leak`", not "we need new
regexes".

---

## 3. False positives (the 4 FPs)

ZeroU's run emitted 7 findings. 3 match Z-01..Z-03. The other 4 land
outside the scorer's truth+tolerance window:

| FP # | file:line | rule | Why FP | Root cause |
|---|---|---|---|---|
| FP-1 | `src/secrets.ts:3` | `no-hardcoded-llm-keys.stripe-live-key` | Duplicate of Z-01: the *scorer* requires `rule = secrets-leak.stripe-live-key`; this rule key is `no-hardcoded-llm-keys.stripe-live-key`, so it cannot match a truth. | Built-in compiled-in preset (`cli/src/stubs.ts:193–290`) double-fires alongside the `.md` preset. |
| FP-2 | `src/secrets.ts:4` | `no-hardcoded-llm-keys.aws-access-key` | Duplicate of Z-02 — wrong rule prefix (`aws-access-key` vs truth's `aws-access-key-id`). | Same. |
| FP-3 | `src/secrets.ts:5` | `no-hardcoded-llm-keys.jwt-token` | Duplicate of Z-03 — same line, mismatched preset prefix. | Same. |
| FP-4 | `src/secrets.ts:8` | `no-hardcoded-llm-keys.private-key` | No truth on line 8 — the multi-line PEM block was intentionally seeded as *not a static-grep match*. The built-in's `private-key` rule fires anyway. | Built-in has a rule (`private-key`) with no equivalent in `secrets-leak.md`; truth set excluded it. |

**All 4 FPs share one root**: `HARDCODED_KEY_PRESET` hard-coded in
`cli/src/stubs.ts:193` is unconditionally dispatched alongside
`secrets-leak.md`. **Fix options** (writer decides): (a) delete the
built-in and rely on `.md` (loses `private-key`); (b) rename built-in's
`id` to `secrets-leak` and merge rules; (c) dedup `(file,line,pattern)`
post-scan in the orchestrator.

---

## 4. Preset writes needed

For each existing preset: the rules **already exist with correct
static-grep patterns**. The "write" is mostly **orchestrator-level**
(wire preset into `fallbackBuildChecklist` at
`cli/src/agent/orchestrator.ts:142`). No regex authorship required for
§4b–§4h.

| § | Preset | Static-grep rules to wire | Trigger condition |
|---|---|---|---|
| 4a | `secrets-leak` | (already wired) | always-on. Plus: ADD `private-key-pem` rule (pattern `-----BEGIN (RSA \|EC \|DSA )?PRIVATE KEY-----`, P1); resolve §3 FP. |
| 4b | `db-injection` | `sql-string-interpolation`, `req-body-into-query-unparameterised`, `orm-raw-interpolation`, `mongo-where-injection` | backend = node/prisma/mongoose/express/next |
| 4c | `error-handling` | `stack-trace-leak-in-response`, `catch-all-swallow`, `throw-non-error` | always-on for backend |
| 4d | `observability-missing` | `silent-catch-block`, `console-log-in-prod-paths` | always-on |
| 4e | `security-cors-csp` | `cors-wildcard-with-credentials`, `cookie-missing-secure-or-httponly` | backend = express/koa/fastify/hono/next |
| 4f | `auth-weakness` | `plaintext-password-comparison`, `hardcoded-jwt-secret`, `plaintext-password-storage`, `weak-password-length-check` | signup/login route detected |
| 4g | `authz-bola` | `route-param-id-used-in-query-without-owner-check`, `supabase-select-eq-id-from-params`, `mass-assignment-req-body-spread` | REST / Next routes detected |
| 4h | `perf-issues` | `sync-fs-in-request-handler`, `select-star-without-limit` | always-on for backend |

### 4i. Downgrade priority

These `llm-judgment` rules should ship a sibling `static-grep` so v1
gets *some* coverage even before the critic is wired:

| Existing rule | Suggested static-grep sibling |
|---|---|
| `error-handling.missing-global-error-handler` | grep for absence of `app\.use\(.*err.*\)` in entry file (negative — emit when zero matches) |
| `error-handling.unawaited-promise-in-handler` | grep for `\)\.then\s*\(` inside `async\s+(function\|\(.*\)\s*=>)` blocks (best-effort) |
| `observability-missing.missing-error-tracking-import` | grep `package.json` for one of `@sentry\|@datadog\|honeybadger\|rollbar\|bugsnag` and **invert** (emit when zero matches) |
| `observability-missing.missing-health-endpoint` | grep all source for `['"]/(health\|healthz\|ping\|status)['"]`, invert |
| `authz-bola.admin-endpoint-no-role-check` | grep for `/admin` route with no `requireAdmin\|isAdmin\|role\s*==` within 200 chars |
| `auth-weakness.missing-password-policy-validation` | grep for `signup\|register\|createUser` handlers and check for `min.{0,5}length\|password.{0,30}length` within block |
| `perf-issues.n-plus-one-query` | already has static-grep `pattern` field but `mechanism: llm-judgment` — flip to `static-grep`, accept noise |
| `perf-issues.missing-query-timeout` | same — flip mechanism, accept noise |
| `db-injection.nosql-operator-injection` | same — flip mechanism, accept noise |

These don't move the `zerou-target` recall (none of the 19 truths
require them), but they materially close real-world coverage and the
bench will eventually grow.

### 4j. Effort summary

| Bucket | Files touched | Approx LoC |
|---|---|---|
| Orchestrator wiring (§4b–4h) | `cli/src/agent/orchestrator.ts` + `checklist-builder.ts` | ~60 |
| FP dedupe (§3) | `cli/src/stubs.ts` or new dedup step | ~30 |
| Mechanism flip + sibling rules (§4i) | 5 `.md` files | ~80 frontmatter lines |
| New `secrets-leak.private-key-pem` rule | `presets/secrets-leak.md` | ~12 |
| Tests | `cli/src/audit.test.ts` + new fixture-level test | ~120 |

---

## 5. Categories to add (beyond what `zerou-target` covers)

OWASP Top 10 — 2021:

| OWASP | Today | Gap to add |
|---|---|---|
| A01 Broken Access Control | partial (BOLA only) | dir traversal (`fs.readFile(req.params.path)`), CSRF-token absence, vertical privilege checks. Expand `authz-bola`. |
| A02 Cryptographic Failures | partial | `Math.random` for tokens, weak hash (`md5`/`sha1` for passwords), `rejectUnauthorized: false`, ECB/DES. **New `crypto-weakness`.** |
| A03 Injection | partial (SQL/Mongo) | command injection (`exec(\`… ${req.*}\`)`), template injection, path injection, LDAP. **New `command-injection`.** |
| A04 Insecure Design | no | architecture-level; punt. |
| A05 Security Misconfiguration | partial | default creds, `autoIndex: true`, CORS reflect-origin, `x-powered-by`. Expand `security-cors-csp`. |
| A06 Vulnerable Components | no | `npm audit --json` ingest. **New `vulnerable-deps`.** |
| A07 Auth Failures | partial | session-fixation (no `regenerate` post-login), no `/login` rate-limit, `Math.random` session IDs. Expand `auth-weakness`. |
| A08 Integrity / Deserialization | no | `eval`, `vm.run*`, `yaml.load` (unsafe), `node-serialize.unserialize`, prototype pollution. **New `unsafe-deserialization`.** |
| A09 Logging Failures | partial | auth-event no-log, PII in logs. Expand `observability-missing`. |
| A10 SSRF | no | `fetch(req.body.url)`, `res.redirect(req.query.*)`. **New `ssrf`.** |

### Beyond OWASP — Node/TS-idiomatic anti-patterns

| Anti-pattern | Grep | Sev | Preset |
|---|---|---|---|
| `@ts-ignore` / `@ts-expect-error` | `@ts-(ignore\|expect-error)` | P3 | new `type-safety-escapes` |
| `as any` in non-test code | `\bas\s+any\b` in `src/**` excl. `*.test.ts` | P3 | same |
| `.catch(noop)` variant | `\.catch\(\s*noop\s*\)` | P2 | extend `error-handling.catch-all-swallow` |
| `innerHTML`/`outerHTML` with `req.*` | `\.(innerHTML\|outerHTML)\s*=\s*[^;]*\breq\.` | P1 | new `xss-dom` |
| `dangerouslySetInnerHTML` w/ user data | `dangerouslySetInnerHTML\s*=\s*\{\s*\{[^}]*\b(req\|props\.\w+)` | P1 | same |
| `eval` / `new Function` | `\b(eval\|new\s+Function\|Function)\s*\(` | P1 | new `dangerous-eval` |
| `Math.random` for token/secret/session | `Math\.random\s*\(\)` within 50 chars of `(token\|secret\|session\|nonce\|csrf)` | P1 | `crypto-weakness` |
| TODO/FIXME with security keyword | `(TODO\|FIXME\|XXX\|HACK).{0,80}(security\|auth\|password\|secret\|crypto)` | P2 | new `security-todo` |
| Proto-pollution via `Object.assign` from req | `Object\.assign\s*\(\s*\w+\s*,\s*req\.(body\|query)` | P1 | new `prototype-pollution` |
| `lodash.merge` / `_.merge` w/ req | `(_\.merge\|lodash\.merge)\s*\([^,]+,\s*req\.` | P1 | same |

---

## 6. Coverage projection

If Phase 16 ships §4a–4h (orchestrator wiring of existing static-grep
rules — **no new regex work**) plus the FP dedupe in §3:

- **TPs**: 19 (every Z-* truth has a matching rule already on disk).
- **FPs from `no-hardcoded-llm-keys` overlap**: 0 (deduped).
- **FPs from negatives** (`safe.ts` traps): regexes already designed
  to avoid them — `bcrypt.compare`, parameterised `db.query('… $1', [req.*])`,
  and `process.env.OPENAI_API_KEY`. We expect 0 triggered negatives
  (subject to verification by running the bench).
- **Expected aggregate**: P ≈ 1.00, R ≈ 1.00 on `zerou-target`.

**Realistic** projection (accounting for line-tolerance, fixture drift,
and one or two regex edge cases we'll meet on first run):

- P ≈ 0.85–0.95, R ≈ 0.84–1.00 (16–19 of 19 caught).
- Even the lower bound (16/19 = 0.84) is a **5.3×** improvement over
  today's 0.158, with one PR's worth of orchestrator work.

If we additionally ship §4i (downgrade six `llm-judgment` rules to
`static-grep`) we don't move `zerou-target` numbers but pick up
real-world recall on missing-helmet, no-sentry, no-health,
admin-no-role, etc. — measurable on the eventual MVP-1 benchmark
expansion.

§5 categories (SSRF, command-injection, prototype-pollution,
unsafe-deserialization, crypto-weakness, dangerous-eval, xss-dom) are
post-Phase-16 work — they don't move `zerou-target` but they widen the
preset library for the next bench-fixture iteration.

---

## Appendix — files relevant to writers

- `presets/secrets-leak.md`, `presets/db-injection.md`,
  `presets/error-handling.md`, `presets/observability-missing.md`,
  `presets/security-cors-csp.md`, `presets/auth-weakness.md`,
  `presets/authz-bola.md`, `presets/perf-issues.md` — rule sources;
  rules already correct, only mechanism flips needed for §4i.
- `cli/src/stubs.ts:193–290` — `HARDCODED_KEY_PRESET`; resolve §3 here.
- `cli/src/stubs.ts:374–600` — `defaultRunPreset`; the
  `mechanism !== 'static-grep'` skip at line 382 is what makes
  `llm-judgment` rules dead-code at v1.
- `cli/src/agent/orchestrator.ts:142–195` — `fallbackBuildChecklist`;
  the actual dispatch bottleneck. **This is where most of §4's wiring
  lives.**
- `cli/src/agent/checklist-builder.ts:44` — category→preset map; mirror
  changes here.
- `D:/lll/hardener-bench/scorers/zerou-rule-scorer.ts:113` — match rule
  is `file == truth.file && |line - truth.line| ≤ 2 && rule == "${presetId}.${ruleId}"`. Writers must keep `presetId.ruleId` strings stable.
- `D:/lll/hardener-bench/fixtures/zerou-target/ground-truth.json` —
  truth source. **Don't edit**; the writer worker should make ZeroU
  match this, not the other way around.
