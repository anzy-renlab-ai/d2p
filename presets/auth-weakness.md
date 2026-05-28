---
id: auth-weakness
version: 2
name: Authentication implementation weaknesses
appliesTo: ['saas-web', 'api-service']
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
      pattern: '(insert|create|save|upsert)\s*\(\s*\{[^}]{0,200}password\s*:\s*(req\.body\.password|req\.body\[.password.\])'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: hash before storage — const passwordHash = await bcrypt.hash(req.body.password, 12); then persist passwordHash, not the raw password.'"
      verifyCommand: '! grep -rnE "(insert|create|save|upsert)\s*\(\s*\{[^}]{0,200}password\s*:\s*req\.body\." --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: plaintext-password-comparison
    label: Password compared with === / !== instead of constant-time hash compare
    severity: P1
    mechanism: static-grep
    source: auth-weakness/v2
    rationale: |
      Comparing `req.body.password === user.password` (or `!==`) implies the
      stored password is plaintext AND leaks length via early-exit timing. A
      hashed password must be verified through `bcrypt.compare()` /
      `argon2.verify()` which are constant-time and operate on the hash.
    detection:
      pattern: '(req\.body\.password|password)\s*(===|!==|==|!=)\s*(user\.password|stored|hash|hashed|hashedPassword|row\.password)'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: use bcrypt.compare(req.body.password, user.passwordHash) or argon2.verify(user.passwordHash, req.body.password). Never compare passwords with === — it leaks timing and implies plaintext storage.'"
      verifyCommand: '! grep -rnE "(req\.body\.password|password)\s*(===|!==|==|!=)\s*(user\.password|stored|hash|hashed|hashedPassword|row\.password)" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: hardcoded-jwt-secret
    label: JWT signed/verified with hardcoded or short literal secret
    severity: P1
    mechanism: static-grep
    source: auth-weakness/v2
    rationale: |
      `jwt.sign(payload, 'secret')` or `jwt.verify(token, 'mysecret')` with any
      inline literal means anyone with the source can forge admin tokens or
      verify forged ones. Secrets must come from a runtime env var with at
      least 32 bytes of entropy. Catches both sign and verify shapes with
      string literal second arg.
    detection:
      pattern: 'jwt\.(sign|verify)\s*\([^,]+,\s*[''"][^''"]{1,31}[''"]'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: move secret to env — jwt.sign(payload, process.env.JWT_SECRET, { algorithm: HS256 }). Generate with openssl rand -base64 32. Refuse startup if process.env.JWT_SECRET is missing or < 32 chars.'"
      verifyCommand: '! grep -rnE "jwt\.(sign|verify)\s*\([^,]+,\s*[''\"][^''\"]{1,31}[''\"]" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: missing-jwt-verify
    label: JWT decoded without signature verification (jwt.decode used as auth)
    severity: P1
    mechanism: static-grep
    source: auth-weakness/v2
    rationale: |
      `jwt.decode(token)` parses the payload WITHOUT verifying the signature.
      Vibe-coded auth handlers frequently trust the decoded payload (e.g. read
      `.uid` from it and use it as the caller identity) — an attacker can forge
      any payload by changing the alg to none or just constructing a fresh
      token. Authentication code must use `jwt.verify(token, secret)` which
      checks the signature.
    detection:
      pattern: 'jwt\.decode\s*\('
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: replace jwt.decode with jwt.verify(token, process.env.JWT_SECRET, { algorithms: [HS256] }). jwt.decode is for inspecting tokens you already trust (e.g. logging), never for authentication.'"
      verifyCommand: '! grep -rnE "jwt\.decode\s*\(" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: weak-bcrypt-rounds
    label: bcrypt cost factor too low (rounds <= 4)
    severity: P2
    mechanism: static-grep
    source: auth-weakness/v2
    rationale: |
      `bcrypt.hash(password, 4)` or lower completes a hash in microseconds,
      enabling offline brute force at GPU rates. OWASP ASVS 2.4.1 requires
      bcrypt cost >= 10 (preferably 12+). Cost is logarithmic — each +1 doubles
      the work. Catches numeric literal rounds 1–4 passed as the second arg
      to bcrypt.hash / bcrypt.hashSync / bcrypt.genSalt.
    detection:
      pattern: 'bcrypt\.(hash|hashSync|genSalt|genSaltSync)\s*\([^,)]*,\s*[1-4](?!\d)'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: raise bcrypt cost factor to >= 12 — await bcrypt.hash(password, 12). Cost is logarithmic; 12 is ~250ms on modern hardware which is the recommended floor.'"
      verifyCommand: '! grep -rnE "bcrypt\.(hash|hashSync|genSalt|genSaltSync)\s*\([^,)]*,\s*[1-4]([^0-9]|$)" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: weak-password-length-check
    label: Password length policy below 8 chars
    severity: P2
    mechanism: static-grep
    source: auth-weakness/v2
    rationale: |
      OWASP ASVS 2.1.1 requires passwords to be at least 8 chars (preferably
      12+). A check like `password.length < 6` or `password.length >= 4`
      indicates a policy too weak to resist offline brute force once a hash
      eventually leaks. Detects literal length comparisons below 8.
    detection:
      pattern: '(password|pwd|passwd)(\.length|\?\.length)\s*[<>]=?\s*[1-7](?!\d)'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: enforce min length >= 8 (preferably 12+) and a max of 128. Use a schema validator (zod/joi/yup) so the policy lives in one place and applies to signup + reset.'"
      verifyCommand: '! grep -rnE "(password|pwd|passwd)(\.length|\?\.length)\s*[<>]=?\s*[1-7]([^0-9]|$)" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: session-cookie-missing-httponly
    label: Session/auth cookie set without httpOnly
    severity: P2
    mechanism: static-grep
    source: auth-weakness/v2
    rationale: |
      `res.cookie('session', sid, { maxAge: ... })` without `httpOnly: true`
      lets XSS exfiltrate the session via `document.cookie`. HttpOnly is the
      single most effective mitigation for session theft from injected JS.
      Catches res.cookie / context.cookies.set calls naming a session-like
      cookie that omit `httpOnly` on the same line.
    detection:
      pattern: 'res\.cookie\s*\(\s*[''"](sid|session|sess|token|auth|jwt|access_token|refresh_token)[^)]{0,300}\)(?<!httpOnly[^)]*\))'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: set httpOnly:true on every session cookie — res.cookie(name, val, { httpOnly: true, secure: true, sameSite: lax, maxAge: ... }). XSS cannot read httpOnly cookies via document.cookie.'"
      verifyCommand: 'true'
  - ruleId: session-cookie-missing-secure
    label: Session/auth cookie set without secure flag
    severity: P2
    mechanism: static-grep
    source: auth-weakness/v2
    rationale: |
      `res.cookie('session', sid, { httpOnly: true })` without `secure: true`
      sends the cookie over plain HTTP, leaking it to any on-path attacker
      (coffee-shop wifi, malicious ISP). In production every session cookie
      must be `secure: true`. Detects res.cookie calls naming a session-like
      cookie with no `secure` token on the same line.
    detection:
      pattern: 'res\.cookie\s*\(\s*[''"](sid|session|sess|token|auth|jwt|access_token|refresh_token)[^)]{0,300}\)(?<!secure[^)]*\))'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: set secure:true on every session cookie in production — res.cookie(name, val, { httpOnly: true, secure: process.env.NODE_ENV === production, sameSite: lax }).'"
      verifyCommand: 'true'
  - ruleId: token-in-redirect-url
    label: Auth token leaked via redirect URL query string
    severity: P1
    mechanism: static-grep
    source: auth-weakness/v2
    rationale: |
      `res.redirect(/dashboard?token=${jwt})` or `res.redirect(...?session=...)`
      writes the token into the URL, where it lands in the browser address
      bar, in the Referer header on subsequent requests, in CDN access logs,
      and in browser history. Tokens must travel in Authorization headers or
      httpOnly cookies — never URL query strings.
    detection:
      pattern: '(res\.redirect|Response\.redirect|NextResponse\.redirect)\s*\(\s*[`''"][^`''"]*\?(token|session|access_token|refresh_token|jwt|auth)='
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: set an httpOnly+secure cookie before redirect, or pass a short-lived one-time code that the client exchanges server-to-server. Never put tokens in the redirect URL.'"
      verifyCommand: '! grep -rnE "(res\.redirect|Response\.redirect|NextResponse\.redirect)\s*\(\s*[`''\"][^`''\"]*\?(token|session|access_token|refresh_token|jwt|auth)=" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: missing-password-policy-validation
    label: Signup/register handler accepts password without validation (LLM judgment)
    severity: P2
    mechanism: llm-judgment
    source: auth-weakness/v2
    rationale: |
      Many vibe-coded signup handlers accept `req.body.password` and pass it
      straight to a hash + insert without ANY validation (length, complexity,
      breached-password check). A regex cannot reliably prove "no validation
      happened" — that requires reading the whole handler body and helpers.
      The LLM critic confirms whether validation is present.
    detection:
      pattern: '(signup|signUp|register|createUser|create_user|sign_up)\s*[=:(]'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: parse req.body through a zod/joi schema requiring password length >= 8, max 128, and reject the top 1000 breached passwords (zxcvbn or HaveIBeenPwned k-anonymity).'"
      verifyCommand: 'true'
  - ruleId: route-without-auth-check
    label: API handler reads/writes user data without an auth check (LLM judgment)
    severity: P2
    mechanism: llm-judgment
    source: auth-weakness/v2
    rationale: |
      Next.js / Express handlers that query or mutate user-owned resources
      must verify the caller is authenticated (`getServerUser`, `req.user`,
      `getSession`, `auth()`, JWT middleware, etc.). The pre-filter coarsely
      matches handler exports and route registrations; the LLM critic
      decides whether an auth check is present in the handler body or via
      framework middleware. Skip if framework-level middleware visibly gates
      all routes (e.g. Next.js middleware.ts covering the path).
    detection:
      pattern: 'export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\s*\('
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: add a session check at the top — const user = await getServerUser(); if (!user) return NextResponse.json({ error: login required }, { status: 401 }); — or apply auth middleware in middleware.ts.'"
      verifyCommand: 'true'
  - ruleId: oauth-callback-missing-state-check
    label: OAuth callback handler does not verify state param (LLM judgment)
    severity: P2
    mechanism: llm-judgment
    source: auth-weakness/v2
    rationale: |
      The OAuth `state` parameter is the only defense against CSRF on the
      callback — without it an attacker can stitch their own auth code into
      a victim's session. Pre-filter matches typical callback handler paths;
      LLM critic verifies the handler reads and compares `state` against a
      value set at the authorize step (cookie, session, or signed nonce).
      Supabase / NextAuth / Auth.js usually enforce this automatically; the
      LLM should silence the finding when one of those is detected.
    detection:
      pattern: '/(api/)?(auth/)?(callback|oauth/callback|github/callback|google/callback)'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: at the authorize step, generate a random state, store it in a short-lived signed cookie. At the callback, compare req.query.state with the cookie value; on mismatch return 400. Or use NextAuth/Auth.js which handle this automatically.'"
      verifyCommand: 'true'
---

# Authentication implementation weaknesses

Vibe-coded apps lean on the LLM's "least surprising completion" for auth —
which usually means plaintext storage, naive equality comparisons, JWT
secrets baked into the source, and handlers that forget the session check.
This preset catches twelve common shapes before they reach production.

## Coverage

1. **`plaintext-password-storage`** — `db.users.insert({ password: req.body.password })`.
2. **`plaintext-password-comparison`** — `if (req.body.password === user.password)`.
3. **`hardcoded-jwt-secret`** — `jwt.sign(payload, 'secret')` / `jwt.verify(token, 'mysecret')`.
4. **`missing-jwt-verify`** — `jwt.decode(token)` used as if it authenticated.
5. **`weak-bcrypt-rounds`** — `bcrypt.hash(pw, 4)` cost factor too low.
6. **`weak-password-length-check`** — `password.length < 6` style minimums.
7. **`session-cookie-missing-httponly`** — session cookie set without `httpOnly`.
8. **`session-cookie-missing-secure`** — session cookie set without `secure`.
9. **`token-in-redirect-url`** — `res.redirect(...?token=...)`.
10. **`missing-password-policy-validation`** — signup handler skips validation (LLM).
11. **`route-without-auth-check`** — handler reads user data with no session check (LLM).
12. **`oauth-callback-missing-state-check`** — OAuth callback skips CSRF state (LLM).

## Remediation

1. **Hash on the way in.** Use bcrypt with cost factor >= 12 or argon2id:
   `const hash = await bcrypt.hash(req.body.password, 12);`
2. **Compare via the library.** Never use `===` against a hash:
   `const ok = await bcrypt.compare(req.body.password, user.passwordHash);`
3. **JWT secret from env, 32+ bytes.**
   `jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256' })`.
   Generate with `openssl rand -base64 32`. Refuse startup if missing.
4. **Always verify, never decode.** `jwt.verify(token, secret)` for auth;
   `jwt.decode` is for log lines on tokens you've already verified.
5. **Validate password policy server-side.** Use a schema (zod / joi / yup)
   to require min length >= 8, max length 128, and reject the top 1000
   breached passwords (e.g. via `zxcvbn` or HaveIBeenPwned k-anonymity).
6. **Session cookies: `httpOnly: true, secure: true, sameSite: 'lax'`.**
   In production these are non-negotiable.
7. **Never put tokens in URLs.** Use Authorization headers or httpOnly
   cookies. URLs land in logs, Referer headers, and browser history.
8. **Authenticate every protected handler.** Add `const user = await
   getServerUser(); if (!user) return 401;` or apply auth middleware.
9. **OAuth state.** Always generate + verify `state`. Prefer NextAuth /
   Auth.js / Supabase which do this for you.
10. **Add rate limiting on `/login` and `/signup`.** Without it, weak password
    policies are trivially brute-forced.
11. **Set short JWT lifetimes (15–60 min) + refresh tokens.**
12. **Rotate any secret that ever lived in source.** Git history is permanent.

Re-run `zerou audit` after each fix and confirm zero findings remain on
this preset.
