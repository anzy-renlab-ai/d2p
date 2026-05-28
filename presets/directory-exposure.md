---
id: directory-exposure
version: 1
name: Filesystem & directory-listing exposure
appliesTo: ['saas-web', 'api-service']
rules:
  - ruleId: serve-index-middleware
    label: Express serve-index middleware exposes directory listing
    severity: P1
    mechanism: static-grep
    source: directory-exposure/v1
    rationale: |
      `app.use('/path', serveIndex(dir))` walks the directory on every request
      and renders an HTML index page. Any file under `dir` becomes browsable
      by URL — including config dumps, log files, and "confidential" docs
      developers tucked away assuming nobody would guess the path. OWASP
      Juice Shop's `directoryListingChallenge` is `serveIndex('ftp', ...)` on
      `/ftp`; `accessLogDisclosureChallenge` is the same primitive on
      `/support/logs`. Disable directory listing; serve files individually
      with explicit authorization.
    detection:
      pattern: \bserveIndex\s*\(
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: remove serveIndex(); serve files individually via res.sendFile after an authorization check, or move static assets behind a CDN with explicit allow-list.'"
      verifyCommand: '! grep -rnE "\\bserveIndex\\s*\\(" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.mjs" --include="*.cjs" .'
  - ruleId: express-static-too-broad
    label: express.static mounted on a root / source / dotfile directory
    severity: P2
    mechanism: llm-judgment
    source: directory-exposure/v1
    rationale: |
      `app.use(express.static(__dirname))` or `app.use('/src', express.static('src'))`
      ships the entire source tree, including `.env*`, `node_modules`, build
      artifacts with embedded comments, and `.git/`. The pre-filter catches
      common dangerous mount paths; LLM critic decides whether the directory
      contains secrets / source / VCS. Best practice: serve only `dist/` or
      `public/` and never mix it with config / source.
    detection:
      pattern: express\.static\s*\(\s*(['"]\.?['"]|__dirname|process\.cwd\(\)|['"](src|lib|app|server|node_modules|config|\.git|\.well-known)['"])
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: serve only the dist/public bundle — app.use(express.static(path.resolve(dist/public))). Add an explicit allow-list and a directory-listing-off setting.'"
      verifyCommand: 'true'
  - ruleId: unauthed-metrics-endpoint
    label: Express /metrics route registered (verify auth middleware)
    severity: P2
    mechanism: static-grep
    source: directory-exposure/v1
    rationale: |
      `app.get('/metrics', ...)` exposes Prometheus-style metrics, often
      including process memory, request counts per route, and sometimes user
      IDs in label cardinality. OWASP Juice Shop's `exposedMetricsChallenge`
      is precisely this shape — unauthenticated `/metrics`. Production
      deployments should gate metrics behind basic-auth or a private
      network / sidecar-only port. Pre-filter matches the route; LLM critic
      confirms auth middleware presence.
    detection:
      pattern: app\.(get|use)\s*\(\s*['"]\/metrics['"]
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: gate /metrics behind basicAuth(...) or a dedicated metrics port bound to the private network. Never expose Prometheus counters on the public listener.'"
      verifyCommand: 'true'
  - ruleId: error-stack-leaks-path
    label: Error handler returns stack trace / file path in response body
    severity: P3
    mechanism: llm-judgment
    source: directory-exposure/v1
    rationale: |
      `res.status(500).send(err.stack)` / `res.json({ error: err.message })`
      where `err.message` includes the absolute server path leaks deployment
      layout. Helps an attacker target local-file-read primitives. Pre-filter
      catches obvious shapes; LLM critic confirms whether prod-mode strips
      the detail.
    detection:
      pattern: res\.(send|json|write|end)\s*\([^)]*err(or)?\.(stack|message|toString)
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: in production return only a stable error code + correlation id; log the stack server-side. Use errorhandler() with NODE_ENV-gated detail.'"
      verifyCommand: 'true'
---

# Filesystem & directory-listing exposure

Express + Node apps frequently mount the wrong directory or forget to gate
the metrics / debug routes. This preset catches four high-impact shapes:

1. **`serve-index-middleware`** — `serveIndex(...)` lets anyone browse the
   directory by URL. OWASP Juice Shop's `directoryListingChallenge` and
   `accessLogDisclosureChallenge` are exactly this.
2. **`express-static-too-broad`** — `express.static(__dirname)` etc. ships
   source / config / `.env*`.
3. **`unauthed-metrics-endpoint`** — `/metrics` without auth leaks process
   stats and request cardinality (OWASP Juice Shop's
   `exposedMetricsChallenge`).
4. **`error-stack-leaks-path`** — error handlers that ship stack traces
   reveal server paths.

## Remediation

### Disable directory browsing

```js
// Bad
app.use('/ftp', serveIndex('ftp', { icons: true }));

// Good — explicit allow-list of files behind auth
app.get('/ftp/:file', requireAuth, (req, res) => {
  const allowed = new Set(['README.md', 'public-brochure.pdf']);
  if (!allowed.has(req.params.file)) return res.sendStatus(404);
  res.sendFile(path.join(FTP_ROOT, req.params.file));
});
```

### Scope static mounts

```js
// Bad
app.use(express.static(__dirname));

// Good
app.use(express.static(path.resolve(__dirname, 'public')));
```

### Gate /metrics

```js
// Bad
app.get('/metrics', handler);

// Good
app.get('/metrics', basicAuth({ users: { metrics: process.env.METRICS_PW } }), handler);
// or bind a separate listener to a private network
```

### Strip error detail in production

```js
app.use((err, req, res, next) => {
  const safe = process.env.NODE_ENV === 'production'
    ? { error: 'internal_error', requestId: req.id }
    : { error: err.message, stack: err.stack };
  res.status(500).json(safe);
});
```

After each fix, re-run `zerou audit` and confirm zero findings on this preset.
