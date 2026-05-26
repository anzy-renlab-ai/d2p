---
id: authz-bola
version: 2
name: Broken Object Level Authorization (BOLA / IDOR)
appliesTo: []
rules:
  - ruleId: route-param-id-used-in-query-without-owner-check
    label: req.params.id flows into a DB lookup with no owner / role gate
    severity: P1
    mechanism: static-grep
    source: authz-bola/v2
    rationale: |
      OWASP API #1 (BOLA / IDOR) is the single most common API vuln. The
      classic shape is `GET /api/orders/:id` → handler does
      `db.orders.findUnique({ where: { id: req.params.id } })` and returns the
      row with no `userId === req.user.id` check. This regex catches the
      direct flow from `req.params.id` into a `findUnique` / `findFirst` /
      `findOne` / `select(...).eq('id', ...)` call.
    detection:
      pattern: '(findUnique|findFirst|findOne|find_by_id|getById|getOne)\s*\(\s*\{[^}]*(?:where\s*:\s*)?\{[^}]*id\s*:\s*req\.params\.id'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      verifyCommand: '! grep -rnE "(findUnique|findFirst|findOne|find_by_id|getById|getOne)\s*\(\s*\{[^}]*(where\s*:\s*)?\{[^}]*id\s*:\s*req\.params\.id" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: supabase-select-eq-id-from-params
    label: Supabase .eq('id', req.params.id) without RLS / userId filter
    severity: P1
    mechanism: static-grep
    source: authz-bola/v2
    rationale: |
      Supabase clients chain `.eq('id', req.params.id)` with no second
      `.eq('user_id', auth.uid())` constraint, leaking every row by primary
      key. RLS catches this if enabled, but most vibe-coded apps disable
      RLS or use the service-role key on the server.
    detection:
      pattern: '\.eq\s*\(\s*[''"]id[''"]\s*,\s*req\.(params|query|body)\.'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      verifyCommand: '! grep -rnE "\.eq\s*\(\s*[''\"]id[''\"]\s*,\s*req\.(params|query|body)\." --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: mass-assignment-req-body-spread
    label: Update / create call uses ...req.body without field whitelist
    severity: P1
    mechanism: static-grep
    source: authz-bola/v2
    rationale: |
      `db.users.update({ where: { id }, data: { ...req.body } })` lets a
      malicious client set `role: 'admin'`, `isVerified: true`, or any other
      column. Mass-assignment via spread is one of the most reliable
      privilege-escalation primitives in modern Node stacks.
    detection:
      pattern: '(update|create|insert|save|upsert)\s*\(.*(data|values|set)\s*:\s*\{?\s*\.\.\.\s*req\.body'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      verifyCommand: '! grep -rnE "(update|create|insert|save|upsert)\s*\(.*(data|values|set)\s*:\s*\{?\s*\.\.\.\s*req\.body" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: admin-endpoint-no-role-check
    label: Handler with admin/ prefix or "admin" in name has no role gate (LLM judgment)
    severity: P1
    mechanism: llm-judgment
    source: authz-bola/v2
    rationale: |
      `app.get('/admin/users', handler)` or `app.post('/api/admin/refund', ...)`
      need a role check (`req.user.role === 'admin'` / middleware). Regex
      cannot prove "no middleware ran" because the gate may be applied at
      router or app level. LLM critic reads the handler + router file and
      verdicts.
    detection:
      pattern: '(app|router|api)\.(get|post|put|patch|delete)\s*\(\s*[''"]/?(api/)?admin'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    llmPolicy:
      criticEnforce: true
      maxTokens: 1200
    fix:
      kind: llm-only
      verifyCommand: 'true'
---

# Broken Object Level Authorization (BOLA / IDOR)

OWASP API Top-10 #1. Any endpoint that accepts an object identifier from the
client and does not verify the caller owns (or has a role permitting access to)
that object leaks data across users. Vibe-coded apps almost always ship with
at least one BOLA — the LLM emits "the natural CRUD shape" and skips the
ownership check.

## Coverage

1. **`route-param-id-used-in-query-without-owner-check`** — direct flow
   `req.params.id` → `findUnique` / `findOne`.
2. **`supabase-select-eq-id-from-params`** — Supabase `.eq('id', req.params.id)`
   without a paired user-scope `.eq`.
3. **`mass-assignment-req-body-spread`** — `...req.body` spread into update
   payload, allowing role/flag escalation.
4. **`admin-endpoint-no-role-check`** — admin-prefixed route with no
   detectable role gate (LLM-judged).

## Remediation

1. **Enforce ownership in the where clause.** Always scope by `userId`:
   `db.orders.findFirst({ where: { id: req.params.id, userId: req.user.id } })`
   — returns null instead of leaking another user's row.
2. **Use a 403 distinct from 404 only when necessary.** Returning 404 for
   "not yours" prevents enumeration of valid IDs.
3. **Whitelist fields on every mutation.** Pick a schema (zod, valibot) and
   parse `req.body` into a typed object that excludes server-controlled
   columns: `const data = UpdateUserSchema.parse(req.body)`.
4. **Never spread `req.body` into a DB call.** Refactor to explicit field
   assignment: `data: { name: parsed.name, bio: parsed.bio }`.
5. **Put role checks in middleware.** `requireAdmin` middleware on all
   `/api/admin/*` routes so the check is uniform and cannot be skipped by
   adding a new handler.
6. **Audit every `:id` route once per release.** A simple grep over
   `req.params.id` plus a checklist beats hoping nobody forgot the gate.
7. **Pair with RLS where available** (Supabase, Postgres row-level security).
   Defense in depth: even if the server forgets the check, the DB refuses.
8. Re-run `zerou audit` after fixes; expect zero findings on this preset.
