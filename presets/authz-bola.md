---
id: authz-bola
version: 2
name: Broken Object Level Authorization (BOLA / IDOR)
appliesTo: ['saas-web', 'api-service']
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
      `findOne` / `getById` call.
    detection:
      pattern: '(findUnique|findFirst|findOne|find_by_id|getById|getOne)\s*\(\s*\{[^}]*(?:where\s*:\s*)?\{[^}]*id\s*:\s*req\.(params|body|query)\.'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: scope by ownership — findFirst({ where: { id: req.params.id, userId: req.user.id } }). Returns null instead of leaking another user's row. Pair with RLS where available for defense in depth.'"
      verifyCommand: '! grep -rnE "(findUnique|findFirst|findOne|find_by_id|getById|getOne)\s*\(\s*\{[^}]*(where\s*:\s*)?\{[^}]*id\s*:\s*req\.(params|body|query)\." --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: supabase-select-eq-id-from-params
    label: Supabase .eq('id', req.params.id) without paired user-scope filter
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
      command: "echo 'manual remediation: chain a second .eq(user_id, session.user.id). Or rely on RLS — but verify the policy actually exists and isn't bypassed by the service-role key.'"
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
      privilege-escalation primitives in modern Node stacks. Parse req.body
      into a typed schema first.
    detection:
      pattern: '(update|create|insert|save|upsert)\s*\([^)]{0,400}(data|values|set)\s*:\s*\{?\s*\.\.\.\s*req\.body'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: parse req.body through a zod/valibot schema that whitelists only user-editable fields, then assign explicitly — data: { name: parsed.name, bio: parsed.bio }. Never spread req.body into a DB call.'"
      verifyCommand: '! grep -rnE "(update|create|insert|save|upsert)\s*\([^)]{0,400}(data|values|set)\s*:\s*\{?\s*\.\.\.\s*req\.body" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: update-with-user-controlled-id
    label: Update / delete keyed by id taken from req.body or req.query
    severity: P1
    mechanism: static-grep
    source: authz-bola/v2
    rationale: |
      `db.update({ where: { id: req.body.id }, ... })` or `delete({ id: req.query.id })`
      lets the client pick WHICH row to mutate, regardless of the URL. The
      handler still needs to scope by `userId: req.user.id` AND should ideally
      take the id from the route segment, not the body. Catches the classic
      "trust the body" shape.
    detection:
      pattern: '(update|delete|destroy|remove|upsert)\s*\([^)]{0,400}(where\s*:\s*)?\{[^}]*id\s*:\s*req\.(body|query)\.'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: take the id from req.params (route segment), not req.body. Then scope by ownership — where: { id: req.params.id, userId: req.user.id }.'"
      verifyCommand: '! grep -rnE "(update|delete|destroy|remove|upsert)\s*\([^)]{0,400}(where\s*:\s*)?\{[^}]*id\s*:\s*req\.(body|query)\." --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: role-assignment-from-request
    label: Role / privilege field assigned from req.body or req.query
    severity: P1
    mechanism: static-grep
    source: authz-bola/v2
    rationale: |
      `{ role: req.body.role }` or `{ isAdmin: req.body.isAdmin }` lets the
      client choose its own role. This is the textbook privilege-escalation
      primitive — paired with mass-assignment it bypasses every higher-layer
      check. Privilege fields must be set by server-side logic only (admin
      tool, role assignment workflow), never read from user input.
    detection:
      pattern: '\b(role|roles|isAdmin|is_admin|admin|permissions|scopes|privilege|privileges|access_level)\s*:\s*req\.(body|query|params)\.'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: never read role / isAdmin / permissions from req.body. Set them server-side only. If the user truly needs to change role (e.g. invite flow), do it through a dedicated admin-only endpoint that checks req.user.role === admin first.'"
      verifyCommand: '! grep -rnE "\b(role|roles|isAdmin|is_admin|admin|permissions|scopes|privilege|privileges|access_level)\s*:\s*req\.(body|query|params)\." --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: admin-flag-from-cookie-or-header
    label: Admin / role decision driven by raw cookie or header value
    severity: P2
    mechanism: static-grep
    source: authz-bola/v2
    rationale: |
      `if (req.cookies.is_admin)` or `if (req.headers['x-role'] === 'admin')`
      trusts client-set state — the user can set any cookie value in their
      own browser, and unauthenticated headers are similarly free-form.
      Role must come from a verified session (DB lookup keyed by session id,
      verified JWT, or framework session like NextAuth.session.user.role).
    detection:
      pattern: 'if\s*\(\s*req\.(cookies|headers|cookie)(\.|\[)[^)]{0,80}(is_?admin|role|isAdmin|admin)'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: never trust client cookies/headers for role. Look up the role from the verified session: const user = await getServerUser(); if (user?.role !== admin) return 403.'"
      verifyCommand: '! grep -rnE "if\s*\(\s*req\.(cookies|headers|cookie)(\.|\[)[^)]{0,80}(is_?admin|role|isAdmin|admin)" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: admin-endpoint-no-role-check
    label: Admin-prefixed route has no role gate (LLM judgment)
    severity: P1
    mechanism: llm-judgment
    source: authz-bola/v2
    rationale: |
      `app.get('/admin/users', handler)` or `app.post('/api/admin/refund', ...)`
      needs a role check (`req.user.role === 'admin'` / middleware). Regex
      cannot prove "no middleware ran" because the gate may be applied at
      router or app level. LLM critic reads the handler + router file and
      verdicts. Silence if a `requireAdmin` middleware visibly wraps the
      route.
    detection:
      pattern: '(app|router|api)\.(get|post|put|patch|delete)\s*\(\s*[''"]/?(api/)?admin'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: add a requireAdmin middleware applied at the router level — router.use(/admin, requireAdmin). Inside requireAdmin: verify session, look up role from DB, return 403 if not admin.'"
      verifyCommand: 'true'
  - ruleId: idor-resource-fetch-without-owner-predicate
    label: Resource fetched by route id without ownership predicate (LLM judgment)
    severity: P1
    mechanism: llm-judgment
    source: authz-bola/v2
    rationale: |
      Next.js App Router and Express handlers commonly load resources like
      `/users/:id`, `/orders/:id`, `/files/:id`, `/projects/:id` by primary
      key only. The static-grep rules above catch the literal `req.params.id`
      shape; this LLM rule catches the broader Next.js pattern
      `params.id` / drizzle `eq(table.id, id)` / sequelize `findByPk` where
      regex cannot tell whether ownership is enforced. The LLM inspects the
      whole handler + auth helper imports. Silences when the resource is
      legitimately public-read (e.g. /posts/:id on a blog) — that decision
      requires reading rationale comments and route docs.
    detection:
      pattern: '(params\s*:\s*[^)]{0,80}\{[^}]*id|params\.id|params\[.id.\])'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: if the resource is user-owned, add a where clause filtering by req.user.id (drizzle: and(eq(table.id, id), eq(table.userId, user.id))). If genuinely public-read, add a comment // public-read by design so future audits silence.'"
      verifyCommand: 'true'
---

# Broken Object Level Authorization (BOLA / IDOR)

OWASP API Top-10 #1. Any endpoint that accepts an object identifier from the
client and does not verify the caller owns (or has a role permitting access
to) that object leaks data across users. Vibe-coded apps almost always ship
with at least one BOLA — the LLM emits "the natural CRUD shape" and skips
the ownership check.

## Coverage

1. **`route-param-id-used-in-query-without-owner-check`** — direct flow
   `req.params.id` → `findUnique` / `findOne`.
2. **`supabase-select-eq-id-from-params`** — Supabase `.eq('id', req.params.id)`
   without a paired user-scope `.eq`.
3. **`mass-assignment-req-body-spread`** — `...req.body` spread into update
   payload, allowing role/flag escalation.
4. **`update-with-user-controlled-id`** — update / delete keyed by id taken
   from `req.body` or `req.query` instead of the route segment.
5. **`role-assignment-from-request`** — `role: req.body.role` (privilege
   escalation primitive).
6. **`admin-flag-from-cookie-or-header`** — `if (req.cookies.is_admin)`
   (trusting client-set state).
7. **`admin-endpoint-no-role-check`** — admin-prefixed route with no
   detectable role gate (LLM-judged).
8. **`idor-resource-fetch-without-owner-predicate`** — Next/Drizzle/Sequelize
   resource fetch where ownership cannot be statically verified (LLM-judged).

## Remediation

1. **Enforce ownership in the where clause.** Always scope by `userId`:
   `db.orders.findFirst({ where: { id: req.params.id, userId: req.user.id } })`
   — returns null instead of leaking another user's row.
2. **Take ids from the route segment, not the body.** `req.params.id` is the
   contract; `req.body.id` lets the client pick what to update.
3. **Whitelist fields on every mutation.** Pick a schema (zod, valibot) and
   parse `req.body` into a typed object that excludes server-controlled
   columns: `const data = UpdateUserSchema.parse(req.body)`.
4. **Never spread `req.body` into a DB call.** Refactor to explicit field
   assignment: `data: { name: parsed.name, bio: parsed.bio }`.
5. **Never assign privilege fields from request.** `role`, `isAdmin`,
   `permissions`, `scopes`, `verified` — all set server-side only.
6. **Put role checks in middleware.** `requireAdmin` middleware on all
   `/api/admin/*` routes so the check is uniform and cannot be skipped by
   adding a new handler.
7. **Distinguish public-read from owner-only.** Annotate public-read routes
   (`/posts/:id`, `/memes/:id` on a public board) with a comment so future
   audits silence; default everything else to owner-scoped.
8. **Audit every `:id` route once per release.** A simple grep over
   `req.params.id` + `params.id` + `findByPk` plus a checklist beats hoping
   nobody forgot the gate.
9. **Pair with RLS where available** (Supabase, Postgres row-level security).
   Defense in depth: even if the server forgets the check, the DB refuses.
   Confirm the policy exists AND the service-role key isn't bypassing it.
10. Re-run `zerou audit` after fixes; expect zero findings on this preset.
