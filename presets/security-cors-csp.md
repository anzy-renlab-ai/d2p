---
id: security-cors-csp
version: 2
name: CORS / CSP / cookie / security-header check
appliesTo: []
rules:
  - ruleId: cors-allow-origin-star
    label: CORS Access-Control-Allow-Origin set to wildcard
    severity: P2
    mechanism: static-grep
    source: security-cors-csp/v2
    rationale: A wildcard `Access-Control-Allow-Origin: *` is dangerous on any authenticated endpoint. If credentials are ever enabled (cookies, Authorization header) the browser will still block the request, but the misconfiguration signals broken intent. Pin to an explicit allow-list.
    detection:
      pattern: Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*['"]|cors\s*\(\s*\{[^}]*origin\s*:\s*['"]\*['"]
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace Access-Control-Allow-Origin: * with cors({ origin: [\"https://app.example.com\"], credentials: true })'"
      verifyCommand: "! grep -rE 'Access-Control-Allow-Origin[`\\\"'\\'']?\\s*[,:]\\s*[`\\\"'\\'']\\*[`\\\"'\\'']' src/"
  - ruleId: cors-no-config
    label: Express bootstrap with no CORS middleware (LLM-judged)
    severity: P3
    mechanism: llm-judgment
    source: security-cors-csp/v2
    rationale: Express has no default CORS behaviour, so omission means either the API is intentionally single-origin or the dev forgot. LLM reviews `app.use(...)` for explicit `cors()` or equivalent middleware.
    detection:
      pattern: express\s*\(\s*\)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: install cors and call app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true })) before route mounts'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: csp-missing
    label: No Content-Security-Policy header set anywhere
    severity: P2
    mechanism: llm-judgment
    source: security-cors-csp/v2
    rationale: Without a CSP, the browser permits inline scripts, eval, and arbitrary remote script loads — a single XSS becomes full account takeover. LLM judges whether any source file (middleware, headers config, helmet config) emits a CSP directive.
    detection:
      pattern: Content-Security-Policy|contentSecurityPolicy
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs,json,toml,yaml,yml}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: set Content-Security-Policy: default-src self; script-src self nonce-{X}; object-src none; frame-ancestors none; base-uri self via helmet or platform _headers'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: helmet-missing
    label: Express app created without app.use(helmet())
    severity: P2
    mechanism: static-grep
    source: security-cors-csp/v2
    rationale: `helmet()` is a single line that sets a bundle of defensive headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS). Express apps that don't install it ship with browser defaults — which means none of those headers.
    detection:
      pattern: const\s+app\s*=\s*express\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: import helmet from helmet; app.use(helmet()); before route mounts'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: csp-unsafe-inline
    label: CSP directive includes 'unsafe-inline'
    severity: P2
    mechanism: static-grep
    source: security-cors-csp/v2
    rationale: `'unsafe-inline'` in `script-src` defeats most of CSP's value — XSS can again inject `<script>` tags. Use nonces or hashes instead. `'unsafe-inline'` in `style-src` is less critical but still worth replacing with nonces.
    detection:
      pattern: (?:['"])unsafe-inline(?:['"])
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs,json,toml,yaml,yml}
    fix:
      kind: template
      command: "echo 'manual remediation: replace unsafe-inline with nonce-{value} or sha256-{hash} directives'"
      verifyCommand: "! grep -rE '[`\\\"'\\'']unsafe-inline[`\\\"'\\'']' src/"
  - ruleId: csp-unsafe-eval
    label: CSP directive includes 'unsafe-eval'
    severity: P2
    mechanism: static-grep
    source: security-cors-csp/v2
    rationale: `'unsafe-eval'` re-enables `eval`, `new Function`, and `setTimeout(string)`. Combined with any XSS this becomes RCE inside the browser. Few modern frameworks need it — webpack dev mode is the usual reason, and that should not ship to production.
    detection:
      pattern: (?:['"])unsafe-eval(?:['"])
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs,json,toml,yaml,yml}
    fix:
      kind: template
      command: "echo 'manual remediation: remove unsafe-eval from CSP. If webpack dev mode requires it, gate via process.env.NODE_ENV !== production'"
      verifyCommand: "! grep -rE '[`\\\"'\\'']unsafe-eval[`\\\"'\\'']' src/"
  - ruleId: hsts-missing
    label: Strict-Transport-Security header never referenced
    severity: P2
    mechanism: llm-judgment
    source: security-cors-csp/v2
    rationale: HSTS pins browsers to HTTPS, defeating SSL-strip attacks. Absence of any reference to `Strict-Transport-Security` (in helmet config, middleware, or platform headers) indicates the protection is off. LLM judges whether the project intentionally serves HTTP-only (rare).
    detection:
      pattern: Strict-Transport-Security|hsts
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs,json,toml,yaml,yml}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: set Strict-Transport-Security: max-age=63072000; includeSubDomains via helmet() (default on) or platform headers config'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: x-frame-options-missing
    label: No X-Frame-Options / frame-ancestors set (clickjacking risk)
    severity: P2
    mechanism: llm-judgment
    source: security-cors-csp/v2
    rationale: Without `X-Frame-Options: DENY` or CSP `frame-ancestors 'none'`, the site can be embedded in an attacker iframe and tricked into clickjacking (overlay clicks on real buttons). LLM judges whether either header is set anywhere in source.
    detection:
      pattern: X-Frame-Options|frame-ancestors
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs,json,toml,yaml,yml}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: set X-Frame-Options: DENY or CSP frame-ancestors none via helmet (default on) or platform headers'"
      verifyCommand: "echo 'manual review required'"
---

# CORS / CSP / cookie / security-header check

The browser is the last line of defence against XSS, clickjacking, MITM,
and cross-origin abuse — but only if the server sends the right headers.
Vibe-coded apps almost universally ship with one or more of: wildcard CORS,
no CSP, no HSTS, no `helmet()`, missing frame-ancestors. This preset covers
the eight highest-leverage misconfigurations:

1. **`cors-allow-origin-star`** — wildcard CORS.
2. **`cors-no-config`** — Express bootstrap with no CORS middleware (LLM).
3. **`csp-missing`** — no Content-Security-Policy directive anywhere (LLM).
4. **`helmet-missing`** — Express `app` without `app.use(helmet())`.
5. **`csp-unsafe-inline`** — CSP contains `'unsafe-inline'`.
6. **`csp-unsafe-eval`** — CSP contains `'unsafe-eval'`.
7. **`hsts-missing`** — no Strict-Transport-Security (LLM).
8. **`x-frame-options-missing`** — no X-Frame-Options or frame-ancestors (LLM).

## Remediation

1. **Pin CORS origin to an allow-list.**
   `app.use(cors({ origin: ['https://app.example.com'], credentials: true }))`.
   Never reflect `req.headers.origin` blindly.
2. **Install `helmet()`.** `app.use(helmet())` before route mounts. Helmet
   enables HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff,
   Referrer-Policy, and a baseline CSP.
3. **Tighten CSP.** Start with
   `default-src 'self'; script-src 'self' 'nonce-{X}'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'`,
   then loosen per page. Avoid `'unsafe-inline'` and `'unsafe-eval'`.
4. **Set HSTS on HTTPS-served domains.**
   `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
   Don't enable `preload` until you're committed (hard to undo).
5. **Test the resulting headers.**
   `curl -I https://your.app | grep -iE 'strict|policy|frame|content-security'`
   or run securityheaders.com / Mozilla Observatory.

After fixes, re-run `zerou audit` and confirm zero findings remain.
