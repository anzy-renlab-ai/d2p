---
id: ssrf-path-traversal
version: 2
name: SSRF / path-traversal / open-redirect check
appliesTo: []
rules:
  - ruleId: fetch-user-controlled-url
    label: fetch() URL sourced from request input
    severity: P1
    mechanism: static-grep
    source: ssrf-path-traversal/v2
    rationale: `fetch(req.body.url)` lets an attacker pivot the server to internal hosts (`http://169.254.169.254/`, `http://localhost:6379`, internal admin panels). Always validate against an allow-list of hosts before making the request.
    detection:
      pattern: \bfetch\s*\(\s*(req\.|`[^`]*\$\{\s*req\.)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: validate the URL host against an allow-list before fetch; reject private CIDR ranges (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16)'"
      verifyCommand: "! grep -rE '\\bfetch\\s*\\(\\s*(req\\.|`[^`]*\\$\\{\\s*req\\.)' src/"
  - ruleId: axios-user-controlled-url
    label: axios call with URL sourced from request
    severity: P1
    mechanism: static-grep
    source: ssrf-path-traversal/v2
    rationale: Same SSRF vector as `fetch`. `axios.get(req.body.url)` or `axios({ url: req.query.target })` lets the attacker drive the server's outbound HTTP. Validate the host before the call.
    detection:
      pattern: axios(\.(get|post|put|delete|patch|request|head))?\s*\(\s*(req\.|\{[^}]*url\s*:\s*req\.|`[^`]*\$\{\s*req\.)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: pin axios calls to a hardcoded baseURL or validate target host against an allow-list before axios.get(url)'"
      verifyCommand: "! grep -rE 'axios(\\.(get|post|put|delete|patch|request|head))?\\s*\\(\\s*(req\\.|\\{[^}]*url\\s*:\\s*req\\.|`[^`]*\\$\\{\\s*req\\.)' src/"
  - ruleId: fs-read-user-input
    label: fs.readFile / readFileSync path sourced from request
    severity: P1
    mechanism: static-grep
    source: ssrf-path-traversal/v2
    rationale: `fs.readFile(req.params.file)` permits `../../etc/passwd`, `/etc/shadow`, or any file the Node process can read. Normalise via `path.resolve` and assert the result starts with the intended base directory.
    detection:
      pattern: fs(\.promises)?\.(readFile|readFileSync|createReadStream)\s*\(\s*(req\.|`[^`]*\$\{\s*req\.)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: const safe = path.resolve(BASE, req.params.file); if (!safe.startsWith(BASE + path.sep)) throw 400; then fs.readFile(safe)'"
      verifyCommand: "! grep -rE 'fs(\\.promises)?\\.(readFile|readFileSync|createReadStream)\\s*\\(\\s*(req\\.|`[^`]*\\$\\{\\s*req\\.)' src/"
  - ruleId: fs-write-user-input
    label: fs.writeFile / writeFileSync path sourced from request
    severity: P1
    mechanism: static-grep
    source: ssrf-path-traversal/v2
    rationale: Same traversal as the read case, plus the attacker can overwrite arbitrary files — including `~/.ssh/authorized_keys` or app source code. Normalise + base-prefix the path.
    detection:
      pattern: fs(\.promises)?\.(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(\s*(req\.|`[^`]*\$\{\s*req\.)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: const safe = path.resolve(BASE, req.params.name); if (!safe.startsWith(BASE + path.sep)) throw 400; then fs.writeFile(safe, data)'"
      verifyCommand: "! grep -rE 'fs(\\.promises)?\\.(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\\s*\\(\\s*(req\\.|`[^`]*\\$\\{\\s*req\\.)' src/"
  - ruleId: path-join-user-input
    label: path.join / path.resolve with request input (no base-prefix check)
    severity: P2
    mechanism: static-grep
    source: ssrf-path-traversal/v2
    rationale: `path.join(__dirname, req.body.path)` looks safe but does not block `..` segments — `path.join('/var/app', '../../etc/passwd')` returns `/etc/passwd`. You must call `path.resolve` and then verify the result still starts with the base.
    detection:
      pattern: path\.(join|resolve)\s*\([^)]*req\.(body|params|query)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: const safe = path.resolve(BASE, req.body.path); if (!safe.startsWith(BASE + path.sep)) throw new Error(\"path traversal\")'"
      verifyCommand: "! grep -rE 'path\\.(join|resolve)\\s*\\([^)]*req\\.(body|params|query)' src/"
  - ruleId: redirect-from-input
    label: res.redirect target sourced from request (open redirect)
    severity: P2
    mechanism: static-grep
    source: ssrf-path-traversal/v2
    rationale: `res.redirect(req.query.next)` lets a phishing attacker craft `https://app/login?next=https://evil.example` — users see your trusted domain and end up on an attacker page after login. Validate the target is same-origin or in an allow-list.
    detection:
      pattern: res\.redirect\s*\(\s*(req\.|`[^`]*\$\{\s*req\.)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: validate req.query.next is a relative path (starts with /) or matches an allow-listed host before res.redirect'"
      verifyCommand: "! grep -rE 'res\\.redirect\\s*\\(\\s*(req\\.|`[^`]*\\$\\{\\s*req\\.)' src/"
---

# SSRF / path-traversal / open-redirect check

Three related categories where user input drives the server to fetch, read,
or redirect to an attacker-chosen location:

1. **`fetch-user-controlled-url`** — server-side request forgery via fetch.
2. **`axios-user-controlled-url`** — same vector with axios.
3. **`fs-read-user-input`** — directory traversal on file reads.
4. **`fs-write-user-input`** — directory traversal on writes (worse: arbitrary overwrite).
5. **`path-join-user-input`** — `path.join` does not strip `..` — must base-prefix.
6. **`redirect-from-input`** — open-redirect phishing aid.

## Remediation

### SSRF allow-list

```js
import { URL } from 'node:url';

const ALLOWED_HOSTS = new Set(['api.partner.com', 'cdn.partner.com']);

function safeFetch(target) {
  const u = new URL(target);
  if (!ALLOWED_HOSTS.has(u.host)) throw new Error('host not allowed');
  if (u.protocol !== 'https:') throw new Error('https only');
  return fetch(u.href);
}
```

### Path-traversal guard

```js
import path from 'node:path';
const BASE = path.resolve('/var/app/uploads');

function safeJoin(userPath) {
  const safe = path.resolve(BASE, userPath);
  if (!safe.startsWith(BASE + path.sep)) {
    throw new Error('path traversal');
  }
  return safe;
}
```

### Open-redirect guard

```js
function safeRedirect(res, target) {
  if (target.startsWith('/') && !target.startsWith('//')) {
    return res.redirect(target); // relative path is safe
  }
  return res.redirect('/'); // fall back
}
```

After fixes, re-run `zerou audit` and confirm zero findings remain.
