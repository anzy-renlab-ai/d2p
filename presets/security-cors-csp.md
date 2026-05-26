---
id: security-cors-csp
version: 2
name: CORS / CSP / cookie / security-header misconfiguration
appliesTo: []
rules:
  - ruleId: cors-wildcard-with-credentials
    label: CORS allows '*' origin with credentials true (browser will reject, but the intent is dangerous)
    severity: P1
    mechanism: static-grep
    source: security-cors-csp/v2
    rationale: |
      `Access-Control-Allow-Origin: *` combined with `Access-Control-Allow-Credentials: true`
      is the textbook footgun: when the second one is later loosened (e.g. by
      reflecting the Origin header), every site on the internet can ride the
      user's cookies. Even alone, wildcard CORS on an authenticated API is a
      smell. Catch both shapes — explicit header set, and the equivalent
      `cors({ origin: '*' })` middleware config.
    detection:
      pattern: '(Access-Control-Allow-Origin[''"]?\s*[,:]\s*[''"]\*[''"]|cors\s*\(\s*\{[^}]*origin\s*:\s*[''"]\*[''"]|origin\s*:\s*true\s*,[^}]*credentials\s*:\s*true)'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      verifyCommand: '! grep -rnE "(Access-Control-Allow-Origin[''\"]?\s*[,:]\s*[''\"]\*[''\"]|cors\s*\(\s*\{[^}]*origin\s*:\s*[''\"]\*[''\"])" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: cookie-missing-secure-or-httponly
    label: res.cookie / Set-Cookie without secure+httpOnly flags
    severity: P1
    mechanism: static-grep
    source: security-cors-csp/v2
    rationale: |
      Session cookies set without `httpOnly` are readable by injected JS (XSS
      → full account takeover); without `secure` they leak over HTTP downgrade.
      Express's `res.cookie('sid', value)` defaults to neither — both must be
      explicitly enabled. This regex catches `res.cookie(...)` calls that
      omit either flag in the options object (best-effort; LLM critic confirms).
    detection:
      pattern: 'res\.cookie\s*\([^)]*\)(?!.*httpOnly)(?!.*secure)'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      verifyCommand: '! grep -rnE "res\.cookie\s*\([^)]*\)" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" . | grep -vE "(httpOnly|secure)"'
  - ruleId: missing-helmet-middleware
    label: Express app uses no helmet / security-headers middleware (LLM judgment)
    severity: P2
    mechanism: llm-judgment
    source: security-cors-csp/v2
    rationale: |
      `helmet()` (or equivalent) sets a bundle of defenses: CSP, X-Frame-Options,
      X-Content-Type-Options, Referrer-Policy, Strict-Transport-Security.
      Absence of any header-bundle middleware is a strong signal of "default
      vibe-coded Express app". A simple `import helmet` grep is too noisy
      (presence ≠ correctly applied), so the LLM verdicts whether the app's
      entry file actually wires it.
    detection:
      pattern: '(express\s*\(\s*\)|new\s+Hono\s*\(|fastify\s*\()'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    llmPolicy:
      criticEnforce: true
      maxTokens: 1500
    fix:
      kind: llm-only
      verifyCommand: 'true'
  - ruleId: csp-config-file-missing
    label: No CSP / security-headers config file present at repo root
    severity: P2
    mechanism: file-exists
    source: security-cors-csp/v2
    rationale: |
      Modern frameworks (Next.js, Nuxt, SvelteKit, Astro) all support CSP via
      a dedicated config or middleware file. If none of the standard config
      filenames exist, the app almost certainly ships with default browser
      CSP = none. We accept any one of the common locations.
    detection:
      paths:
        - next.config.js
        - next.config.mjs
        - next.config.ts
        - middleware.ts
        - middleware.js
        - vercel.json
        - netlify.toml
        - public/_headers
      expect: present
    fix:
      kind: template
      command: "echo 'add a middleware.ts (Next.js) or _headers (Netlify/Cloudflare) file that sets Content-Security-Policy + X-Frame-Options DENY + X-Content-Type-Options nosniff + Referrer-Policy strict-origin-when-cross-origin'"
      verifyCommand: 'test -f next.config.js -o -f next.config.mjs -o -f next.config.ts -o -f middleware.ts -o -f middleware.js -o -f vercel.json -o -f netlify.toml -o -f public/_headers'
  - ruleId: hsts-header-missing
    label: Strict-Transport-Security header never set in source
    severity: P3
    mechanism: static-grep
    source: security-cors-csp/v2
    rationale: |
      HSTS pins the browser to HTTPS for `max-age` seconds, preventing SSL-strip
      attacks on cookied users. We grep for ANY occurrence of the header name;
      this rule INVERTS the typical "finding = bad" semantics — zero matches
      means the header is never set. The agent reports the grep result and the
      reviewer pairs this rule with a "fail if no findings" project policy.
    detection:
      pattern: 'Strict-Transport-Security'
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs,json,toml,yaml,yml}'
    fix:
      kind: template
      command: "echo 'set Strict-Transport-Security: max-age=63072000; includeSubDomains; preload via helmet, middleware, or platform _headers file'"
      verifyCommand: 'grep -rE "Strict-Transport-Security" --include="*.ts" --include="*.js" --include="*.json" --include="*.toml" .'
---

# CORS / CSP / cookie / security-header misconfiguration

The browser is the last line of defense against XSS, clickjacking, MITM, and
cross-origin abuse — but only if the server sends the right headers. Vibe-coded
apps almost universally ship with one or more of: wildcard CORS, default
non-`httpOnly` cookies, no CSP, no HSTS. This preset covers the five highest-
leverage defaults.

## Coverage

1. **`cors-wildcard-with-credentials`** — `Access-Control-Allow-Origin: '*'`
   or `cors({ origin: '*' })`.
2. **`cookie-missing-secure-or-httponly`** — `res.cookie(...)` without both
   `httpOnly` and `secure`.
3. **`missing-helmet-middleware`** — Express/Hono/Fastify app with no
   security-header bundle (LLM-judged).
4. **`csp-config-file-missing`** — `file-exists`: no CSP-bearing config file
   in repo root.
5. **`hsts-header-missing`** — `Strict-Transport-Security` never referenced
   anywhere (invert semantics: zero matches = bad).

## Remediation

1. **Pin CORS origin to an allowlist.**
   `cors({ origin: ['https://app.example.com'], credentials: true })`. Never
   reflect `req.headers.origin` blindly.
2. **Set cookie defaults at session-middleware level.** With
   `express-session`: `{ cookie: { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 3600_000 } }`.
3. **Install helmet (or equivalent).** `app.use(helmet({ contentSecurityPolicy: { directives: { ... } } }))`.
   On Next.js, add `headers()` in `next.config.js` or set them in `middleware.ts`.
4. **Define an explicit CSP.** Start with `default-src 'self'; script-src 'self' 'nonce-{X}'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'`,
   then loosen as needed per page.
5. **Set HSTS on HTTPS-served domains.**
   `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
   Don't enable `preload` until you're ready to commit (it's hard to undo).
6. **X-Frame-Options DENY** (or `frame-ancestors 'none'` in CSP) defeats
   clickjacking. **X-Content-Type-Options: nosniff** blocks MIME-sniff attacks.
   **Referrer-Policy: strict-origin-when-cross-origin** prevents URL leakage.
7. **Test the resulting headers.** `curl -I https://your.app | grep -iE 'strict|policy|frame|content-security'`
   or run securityheaders.com / Mozilla Observatory.
8. Re-run `zerou audit`; expect zero findings on this preset.
