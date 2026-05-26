---
id: auth-weakness
version: 2
name: Authentication implementation weaknesses
appliesTo: []
rules:
  - ruleId: plaintext-password-storage
    label: Password inserted/saved without hashing
    severity: P1
    mechanism: static-grep
    source: auth-weakness/v2
    rationale: |
      Persisting a plaintext password makes every DB compromise a full credential
      dump. Vibe-coded apps frequently insert `{ password: req.body.password }`
      directly because the LLM mirrors what's in the request. Hash with bcrypt
      (cost factor >= 10) or argon2id before persisting.
    detection:
      pattern: '(insert|create|save)\s*\(\s*\{[^}]*password\s*:\s*(req\.body\.password|password|req\.body\[''password''\])'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      verifyCommand: '! grep -rnE "(insert|create|save)\s*\(\s*\{[^}]*password\s*:\s*(req\.body\.password|password|req\.body\[..password..\])" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: plaintext-password-comparison
    label: Password compared with === / !== instead of constant-time hash compare
    severity: P1
    mechanism: static-grep
    source: auth-weakness/v2
    rationale: |
      Comparing `req.body.password === user.password` (or `!==`) implies the
      stored password is plaintext AND leaks length/timing. A hashed password
      must be verified through `bcrypt.compare()` / `argon2.verify()` which is
      constant-time.
    detection:
      pattern: '(req\.body\.password|password)\s*(===|!==|==|!=)\s*(user\.password|stored|hash|hashed|hashedPassword|row\.password)'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      verifyCommand: '! grep -rnE "(req\.body\.password|password)\s*(===|!==|==|!=)\s*(user\.password|stored|hash|hashed|hashedPassword|row\.password)" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: hardcoded-jwt-secret
    label: JWT signed with hardcoded or short/weak secret literal
    severity: P1
    mechanism: static-grep
    source: auth-weakness/v2
    rationale: |
      `jwt.sign(payload, 'secret')` or any inline literal secret means anyone
      with the source can forge admin tokens. The secret must come from a
      runtime env var with at least 32 bytes of entropy. This regex catches
      the two most common vibe-coded shapes: literal string second arg, or
      a clearly short word like 'secret' / 'changeme' / 'mysecret'.
    detection:
      pattern: 'jwt\.sign\s*\([^,]+,\s*([''"][^''"]{1,15}[''"]|''secret''|''changeme''|''mysecret''|''jwt-secret'')'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      verifyCommand: '! grep -rnE "jwt\.sign\s*\([^,]+,\s*([''\"][^''\"]{1,15}[''\"])" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: weak-password-length-check
    label: Password length policy below 8 chars or missing
    severity: P2
    mechanism: static-grep
    source: auth-weakness/v2
    rationale: |
      OWASP ASVS 2.1.1 requires passwords to be at least 8 chars (preferably
      12+). A check like `password.length < 6` or `password.length >= 4`
      indicates a policy too weak to resist offline brute force when a hash
      eventually leaks. Detect comparison literals < 8.
    detection:
      pattern: '(password|pwd|passwd)(\.length|\?\.length)\s*[<>]=?\s*[1-7](?!\d)'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      verifyCommand: '! grep -rnE "(password|pwd|passwd)(\.length|\?\.length)\s*[<>]=?\s*[1-7]([^0-9]|$)" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: missing-password-policy-validation
    label: Password field accepted without any length/strength validation (LLM judgment)
    severity: P2
    mechanism: llm-judgment
    source: auth-weakness/v2
    rationale: |
      Many vibe-coded signup handlers accept `req.body.password` and pass it
      straight to a hash + insert without ANY validation. A regex cannot
      reliably tell "no validation happened" — that requires reading the
      surrounding handler. The LLM critic confirms or rejects.
    detection:
      pattern: '(signup|signUp|register|createUser|create_user)\s*[=:(]'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    llmPolicy:
      criticEnforce: true
      maxTokens: 800
    fix:
      kind: llm-only
      verifyCommand: 'true'
---

# Authentication implementation weaknesses

Vibe-coded apps lean on the LLM's "least surprising completion" for auth —
which usually means plaintext storage, naive equality comparisons, and JWT
secrets baked into the source. This preset catches the five highest-impact
shapes before they reach production.

## Coverage

1. **`plaintext-password-storage`** — `db.users.insert({ password: req.body.password })`.
2. **`plaintext-password-comparison`** — `if (req.body.password === user.password)`.
3. **`hardcoded-jwt-secret`** — `jwt.sign(payload, 'secret')`.
4. **`weak-password-length-check`** — `password.length < 6` style minimums.
5. **`missing-password-policy-validation`** — handler that bypasses validation
   entirely (LLM-judged because regex cannot prove absence of validation).

## Remediation

1. **Hash on the way in.** Use bcrypt with cost factor >= 10 or argon2id:
   `const hash = await bcrypt.hash(req.body.password, 12);`
2. **Compare via the library.** Never use `===` against a hash:
   `const ok = await bcrypt.compare(req.body.password, user.passwordHash);`
3. **JWT secret from env, 32+ bytes.** `jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256' })`,
   and generate `JWT_SECRET` with `openssl rand -base64 32`. Reject startup if missing.
4. **Validate password policy server-side.** Use a schema (zod / joi / yup) to
   require min length >= 8, max length 128, and reject the top 1000 breached
   passwords (e.g. via `zxcvbn` or HaveIBeenPwned k-anonymity API).
5. **Rotate any secret that ever lived in source.** Git history is permanent;
   treat past commits as compromise events.
6. **Add rate limiting on `/login`.** Without it, weak password policies are
   trivially brute-forced.
7. **Set short JWT lifetimes (15–60 min) + refresh tokens.** Long-lived JWTs
   amplify the cost of any leak.
8. Re-run `zerou audit` after each fix and confirm zero findings remain.
