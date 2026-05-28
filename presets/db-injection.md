---
id: db-injection
version: 2
name: Database injection & unsafe query check
appliesTo: []
rules:
  - ruleId: raw-sql-template-literal
    label: SQL query built via template-literal interpolation
    severity: P1
    mechanism: static-grep
    source: db-injection/v2
    rationale: Building SQL by interpolating template literals (e.g. `db.query(\`SELECT * FROM users WHERE id = ${id}\`)`) is the textbook SQL injection vector. The query planner cannot distinguish user input from SQL syntax — switch to parameter binding (`db.query(sql, [id])`).
    detection:
      pattern: \b(query|execute|raw)\s*\(\s*`[^`]*\$\{
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace interpolated SQL with parameterised query (e.g. db.query(sql, [id]))'"
      verifyCommand: "! grep -rE '\\b(query|execute|raw)\\s*\\(\\s*\\`[^\\`]*\\$\\{' src/"
  - ruleId: raw-sql-string-concat
    label: SQL query built via string concatenation
    severity: P1
    mechanism: static-grep
    source: db-injection/v2
    rationale: `'SELECT ... ' + variable` is the pre-template-literal form of the same SQL-injection vulnerability. Detect it explicitly because some codebases mix both styles.
    detection:
      pattern: ['"](SELECT|INSERT|UPDATE|DELETE)\s[^'"]*['"][^;]*\+
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace string concatenation with parameterised query — db.query(\"SELECT * FROM t WHERE id = $1\", [id])'"
      verifyCommand: "! grep -rE '[\\\"'\\''](SELECT|INSERT|UPDATE|DELETE)\\s[^\\\"'\\'']*[\\\"'\\''][^;]*\\+' src/"
  - ruleId: mongoose-where-from-input
    label: MongoDB $where operator fed from request input
    severity: P1
    mechanism: static-grep
    source: db-injection/v2
    rationale: MongoDB's `$where` operator evaluates JavaScript server-side. Passing `req.body.*` into `$where` is equivalent to `eval(req.body)` — full RCE on the database. Use typed query operators ($eq, $in) instead.
    detection:
      pattern: \$where\s*:\s*req\.(body|params|query)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace $where with typed operators ($eq, $in); never pass req.* into $where'"
      verifyCommand: "! grep -rE '\\$where\\s*:\\s*req\\.(body|params|query)' src/"
  - ruleId: mongoose-regex-from-input
    label: MongoDB regex query constructed from request input
    severity: P2
    mechanism: static-grep
    source: db-injection/v2
    rationale: `new RegExp(req.params.x)` enables ReDoS (catastrophic backtracking) and can match more documents than expected. Escape the input via `escape-string-regexp` and impose a length cap.
    detection:
      pattern: new\s+RegExp\s*\(\s*req\.(body|params|query)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: escape via escape-string-regexp(req.params.x) and cap length to <100 chars'"
      verifyCommand: "! grep -rE 'new\\s+RegExp\\s*\\(\\s*req\\.(body|params|query)' src/"
  - ruleId: prisma-rawunsafe
    label: Prisma $queryRawUnsafe / $executeRawUnsafe used (skips parameter binding)
    severity: P1
    mechanism: static-grep
    source: db-injection/v2
    rationale: `prisma.$queryRawUnsafe` and `$executeRawUnsafe` deliberately skip Prisma's parameter binding. Use the tagged-template form `prisma.$queryRaw\`...\`` which auto-parameterises, or pass values as a separate array argument.
    detection:
      pattern: prisma\.(\$queryRawUnsafe|\$executeRawUnsafe)\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: switch to prisma.$queryRaw`SELECT ... WHERE id = ${id}` tagged-template form which auto-parameterises'"
      verifyCommand: "! grep -rE 'prisma\\.(\\$queryRawUnsafe|\\$executeRawUnsafe)\\s*\\(' src/"
  - ruleId: drizzle-raw-sql
    label: Drizzle sql`` template with interpolated user input (ORM bypass)
    severity: P2
    mechanism: llm-judgment
    source: db-injection/v2
    rationale: Drizzle exposes a `sql` tag for raw fragments. Within that fragment, interpolated values are NOT auto-bound unless wrapped in `sql.placeholder` or the bind helper. LLM judges whether interpolated values are user-controlled and unbound.
    detection:
      pattern: \bsql`[^`]*\$\{(?!sql\.placeholder)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: wrap interpolations in sql.placeholder, or move to drizzle query builder eq()/and() helpers'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: knex-rawunsafe
    label: Knex .raw() with template-literal interpolation
    severity: P1
    mechanism: static-grep
    source: db-injection/v2
    rationale: `knex.raw(\`SELECT ... ${id}\`)` skips Knex's binding system. Pass parameters as the second argument: `knex.raw('SELECT ... ?', [id])`.
    detection:
      pattern: knex\.raw\s*\(\s*`[^`]*\$\{
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: knex.raw(\"SELECT ... WHERE id = ?\", [id]) — bind values via the second argument'"
      verifyCommand: "! grep -rE 'knex\\.raw\\s*\\(\\s*\\`[^\\`]*\\$\\{' src/"
  - ruleId: like-pattern-no-escape
    label: SQL LIKE pattern built from user input without escaping
    severity: P2
    mechanism: static-grep
    source: db-injection/v2
    rationale: `'%' + req.query.q + '%'` does not parameterise the `%` / `_` wildcards. An attacker can bypass intended filters or trigger ReDoS-like full table scans. Escape `%` and `_` before binding.
    detection:
      pattern: (?:['"`])\s*%(?:['"`])\s*\+|\+\s*(?:['"`])%\s*(?:['"`])
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: escape % and _ in the user input, then bind: db.query(\"... LIKE $1\", [`%${escapeLike(q)}%`])'"
      verifyCommand: "! grep -rE '[\\\"'\\''\\`]\\s*%[\\\"'\\''\\`]\\s*\\+|\\+\\s*[\\\"'\\''\\`]%\\s*[\\\"'\\''\\`]' src/"
---

# Database injection & unsafe query check

Injection remains OWASP Top-10 because vibe-coded apps reach for the shortest
syntax: template strings and string concatenation. This preset surfaces the
eight most damaging patterns across SQL and NoSQL stacks:

1. **`raw-sql-template-literal`** — any `query/execute/raw(\`... ${x} ...\`)`.
2. **`raw-sql-string-concat`** — `'SELECT ...' + variable`.
3. **`mongoose-where-from-input`** — Mongo `$where: req.body.*` (DB-level RCE).
4. **`mongoose-regex-from-input`** — `new RegExp(req.*)` enables ReDoS.
5. **`prisma-rawunsafe`** — `$queryRawUnsafe` / `$executeRawUnsafe` skip binding.
6. **`drizzle-raw-sql`** — Drizzle `sql\`${x}\`` without `sql.placeholder` (LLM-judged).
7. **`knex-rawunsafe`** — `knex.raw(\`${x}\`)` skips Knex bindings.
8. **`like-pattern-no-escape`** — `LIKE '%' + x + '%'` without `%`/`_` escaping.

## Remediation

### pg / mysql2 — bind parameters

```js
// Bad
db.query(`SELECT * FROM users WHERE id = ${id}`);

// Good
db.query('SELECT * FROM users WHERE id = $1', [id]);
```

### Prisma — tagged template

```js
// Bad
prisma.$queryRawUnsafe(`SELECT * FROM users WHERE id = ${id}`);

// Good — tagged template auto-parameterises
prisma.$queryRaw`SELECT * FROM users WHERE id = ${id}`;
```

### Knex — second-arg bindings

```js
// Bad
knex.raw(`SELECT * FROM users WHERE id = ${id}`);

// Good
knex.raw('SELECT * FROM users WHERE id = ?', [id]);
```

### MongoDB — typed operators

```js
// Bad
User.find({ $where: req.body.expr });
User.find({ name: new RegExp(req.params.q) });

// Good
User.find({ email: req.body.email, role: 'user' });
User.find({ name: { $eq: req.body.name } });
```

### SQL LIKE — escape wildcards

```js
function escapeLike(s) { return s.replace(/[\\%_]/g, c => '\\' + c); }
db.query('SELECT * FROM products WHERE name LIKE $1', [`%${escapeLike(q)}%`]);
```

After applying fixes, re-run `zerou audit` and confirm zero findings remain.
