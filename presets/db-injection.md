---
id: db-injection
version: 2
name: Database injection & unsafe query check
appliesTo: []
rules:
  - ruleId: sql-string-interpolation
    label: SQL query built via string interpolation
    severity: P1
    mechanism: static-grep
    source: db-injection/v2
    rationale: Building SQL by concatenating template literals (e.g. `SELECT * FROM users WHERE id = ${id}`) is the textbook SQL injection vector. The query planner cannot distinguish user input from SQL syntax.
    detection:
      pattern: (SELECT|INSERT|UPDATE|DELETE)[^\n`]{0,200}\$\{
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace interpolated SQL with parameterised query (e.g. db.query(sql, [id]) or prepared statements)'"
      verifyCommand: "! grep -rE '(SELECT|INSERT|UPDATE|DELETE)[^\\n\\`]{0,200}\\$\\{' src/"
  - ruleId: req-body-into-query-unparameterised
    label: Request input used directly in SQL query string
    severity: P1
    mechanism: static-grep
    source: db-injection/v2
    rationale: Embedding `req.body.*`, `req.params.*`, or `req.query.*` directly inside a SQL string bypasses parameterisation and allows injection. Always pass user input as a bound parameter, never as a string fragment.
    detection:
      pattern: (query|execute|raw)\s*\([`'"][^`'"\n]*\$\{req\.(body|params|query)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: bind req inputs as parameters — db.query(sql, [req.body.id]) instead of db.query(`... ${req.body.id}`)'"
      verifyCommand: "! grep -rE '(query|execute|raw)\\s*\\([\\`'\\''\"][^\\`'\\''\"\\n]*\\$\\{req\\.(body|params|query)' src/"
  - ruleId: orm-raw-interpolation
    label: ORM raw query (Prisma $queryRaw / Sequelize raw) with template interpolation
    severity: P1
    mechanism: static-grep
    source: db-injection/v2
    rationale: Even ORMs become injectable when you use raw escape hatches with string interpolation. Prisma's `$queryRaw` and Sequelize's `sequelize.query` accept parameter arrays — use them. Template-string interpolation in raw queries reintroduces SQL injection.
    detection:
      pattern: (\$queryRaw|\$executeRaw|sequelize\.query)\s*\(\s*`[^`]*\$\{
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: switch $queryRaw to $queryRawUnsafe + replacements array, or use the tagged-template form prisma.$queryRaw`SELECT ... WHERE id = ${id}` which auto-parameterises'"
      verifyCommand: "! grep -rE '(\\$queryRaw|\\$executeRaw|sequelize\\.query)\\s*\\(\\s*\\`[^\\`]*\\$\\{' src/"
  - ruleId: mongo-where-injection
    label: MongoDB $where operator fed from request input
    severity: P1
    mechanism: static-grep
    source: db-injection/v2
    rationale: MongoDB's `$where` operator evaluates JavaScript server-side. Passing `req.body` straight into `$where` is equivalent to `eval(req.body)` — full RCE on the database. Use typed query operators ($eq, $in) and validate against an allow-list of fields.
    detection:
      pattern: \$where\s*:\s*req\.(body|params|query)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace $where with typed operators ($eq, $in, $regex with validated source); never pass req.* into $where'"
      verifyCommand: "! grep -rE '\\$where\\s*:\\s*req\\.(body|params|query)' src/"
  - ruleId: nosql-operator-injection
    label: Request body spread directly into MongoDB filter
    severity: P2
    mechanism: llm-judgment
    source: db-injection/v2
    rationale: `Model.find(req.body)` lets an attacker inject `{"password": {"$ne": null}}` and bypass equality checks. Always destructure expected fields explicitly rather than passing request bodies wholesale to a query builder.
    detection:
      pattern: \.(find|findOne|findOneAndUpdate|updateOne|updateMany|deleteOne|deleteMany)\s*\(\s*req\.(body|params|query)\s*[\),]
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: destructure the expected fields — Model.find({ email: req.body.email }) — instead of Model.find(req.body)'"
      verifyCommand: "! grep -rE '\\.(find|findOne|findOneAndUpdate|updateOne|updateMany|deleteOne|deleteMany)\\s*\\(\\s*req\\.(body|params|query)\\s*[\\),]' src/"
---

# Database injection & unsafe query check

Injection remains OWASP Top-10 because vibe-coded apps reach for the shortest
syntax: template strings. This preset surfaces the five most damaging patterns:

1. **`sql-string-interpolation`** — any SELECT/INSERT/UPDATE/DELETE built with
   `${...}` template literals.
2. **`req-body-into-query-unparameterised`** — request input concatenated into
   `query()` / `execute()` / `raw()` calls without binding.
3. **`orm-raw-interpolation`** — Prisma `$queryRaw` / Sequelize raw with
   interpolation (the typed tagged-template form is safe; the call form with
   `\`` template literals is not).
4. **`mongo-where-injection`** — MongoDB `$where` fed from `req.*` — equivalent
   to remote code execution on the database.
5. **`nosql-operator-injection`** — entire request body spread into a Mongo
   query, enabling operator injection (`{$ne: null}`, `{$gt: ""}`).

## Remediation

### SQL (parameterised query)

```js
// Bad
db.query(`SELECT * FROM users WHERE id = ${id}`);

// Good — pg / mysql2
db.query('SELECT * FROM users WHERE id = $1', [id]);
```

### Prisma raw

```js
// Bad
prisma.$queryRaw(`SELECT * FROM users WHERE id = ${id}`);

// Good — tagged template auto-parameterises
prisma.$queryRaw`SELECT * FROM users WHERE id = ${id}`;
```

### MongoDB

```js
// Bad
User.find(req.body);
User.find({ $where: req.body.expr });

// Good
User.find({ email: req.body.email, role: 'user' });
```

After applying fixes, re-run `zerou audit` and confirm zero findings remain.
