---
id: client-side-auth
version: 1
name: Client-side authorization & route-guard weaknesses
appliesTo: ['saas-web']
rules:
  - ruleId: angular-route-declaration
    label: Angular route declaration (verify canActivate / canMatch guard is set)
    severity: P2
    mechanism: static-grep
    source: client-side-auth/v1
    rationale: |
      Angular routes lacking `canActivate` / `canActivateChild` / `canMatch`
      load their component as soon as the URL is reached. Hiding the menu
      entry from the UI is NOT security — the URL is still navigable. OWASP
      Juice Shop's `adminSectionChallenge` flags exactly this shape in
      `frontend/src/app/app.routing.ts`: an `administration` route entry whose
      component loads on URL hit. The pattern flags any
      `{ path: 'x', component: Y }` quartet so a reviewer can spot routes
      missing a guard. Pair every sensitive route with a server-verified
      guard.
    detection:
      pattern: \bpath\s*:\s*['"][a-zA-Z][a-zA-Z0-9_/:?-]*['"]\s*,[\s\S]{0,200}?\b(component|loadChildren)\s*:
      filePattern: '**/*.{ts,tsx,js,jsx}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: add canActivate: [AuthGuard] / canMatch: [RoleGuard] to every sensitive route. The guard must verify against the server, not localStorage.'"
      verifyCommand: 'true'
  - ruleId: route-guard-trusts-localstorage
    label: Route guard / interceptor decides on localStorage / sessionStorage value
    severity: P1
    mechanism: static-grep
    source: client-side-auth/v1
    rationale: |
      `if (localStorage.getItem('isAdmin') === 'true')` — or any guard whose
      verdict depends on a client-writable value — is trivially bypassed by
      opening DevTools and setting the key. Auth-relevant decisions must be
      made server-side; the client-side guard is a UX optimization, never
      a security control.
    detection:
      pattern: (localStorage|sessionStorage)\.(getItem|get)\s*\(\s*['"](isAdmin|admin|role|isAuth|authenticated|loggedIn|user|token|jwt)['"]
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: replace the localStorage check with a server call (whoami / session endpoint). Treat the client as untrusted; every authorization decision lives on the server.'"
      verifyCommand: '! grep -rnE "(localStorage|sessionStorage)\\.(getItem|get)\\s*\\(\\s*[\"'\''](isAdmin|admin|role|isAuth|authenticated|loggedIn|user|token|jwt)[\"'\'']" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" .'
  - ruleId: angular-route-lazy-load-without-guard
    label: Angular lazy-loaded route (loadChildren) — verify canLoad / canMatch guard
    severity: P1
    mechanism: static-grep
    source: client-side-auth/v1
    rationale: |
      `loadChildren: async () => import(...)` without `canLoad` / `canMatch`
      will ship the entire feature module bundle to anyone who guesses the
      route — including admin UIs, dev sandboxes, and unreleased features.
      OWASP Juice Shop's `web3SandboxChallenge` is exactly this:
      `loadChildren: async () => await loadWeb3SandboxModule()` with no guard.
    detection:
      pattern: \bloadChildren\s*:
      filePattern: '**/*.{ts,tsx,js,jsx}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: add canLoad: [AuthGuard] alongside loadChildren so the bundle download itself is gated. Server-side auth still required for the underlying API.'"
      verifyCommand: 'true'
  - ruleId: ui-hide-without-route-guard
    label: UI element gated by *ngIf / v-if / show on localStorage value
    severity: P2
    mechanism: static-grep
    source: client-side-auth/v1
    rationale: |
      `*ngIf="isAdmin"` / `v-if="user.role === admin"` only hides the
      element from view. The URL the element links to is still reachable.
      If the same code path is the ONLY thing keeping unauthorized users
      from a feature, the feature is unprotected — server-side authz is
      missing.
    detection:
      pattern: (\*ngIf|v-if|x-if)\s*=\s*["'][^"']*\b(isAdmin|admin|role|isAuth|authenticated|loggedIn)\b
      filePattern: '**/*.{html,vue,svelte,jsx,tsx}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: confirm the underlying route + API endpoint also enforce the role server-side. UI hiding is a UX nicety, not a security control.'"
      verifyCommand: 'true'
  - ruleId: client-side-permission-flag-in-state
    label: Client store holds a permission flag set from client (no server verify)
    severity: P2
    mechanism: llm-judgment
    source: client-side-auth/v1
    rationale: |
      Redux / Pinia / Zustand stores frequently carry an `isAdmin` /
      `permissions: string[]` field initialized from `localStorage` or a JWT
      payload decoded WITHOUT signature verification. The downstream UI
      treats the flag as authoritative. If the only gate on a feature is
      that flag, an attacker who tampered with the JWT or storage walks in.
    detection:
      pattern: (setUser|setRole|setPermissions|setIsAdmin|set_user_role)\s*\(
      filePattern: '**/*.{ts,tsx,js,jsx,mjs,cjs}'
    fix:
      kind: llm-only
      command: "echo 'manual remediation: derive permissions from a verified server response (whoami endpoint); never from a decoded-but-unverified JWT or localStorage. Refresh on every sensitive action.'"
      verifyCommand: 'true'
---

# Client-side authorization & route-guard weaknesses

SPAs (Angular, React, Vue) routinely conflate UI hiding with authorization.
The browser is fully under attacker control — every client-side check is a
UX hint, not a security boundary. This preset catches the five most common
shapes:

1. **`angular-route-without-canactivate`** — Angular routes with no guard
   (OWASP Juice Shop's `adminSectionChallenge`).
2. **`route-guard-trusts-localstorage`** — guard's verdict depends on a
   client-writable value.
3. **`angular-route-lazy-load-without-guard`** — `loadChildren` without
   `canLoad` (OWASP Juice Shop's `web3SandboxChallenge`).
4. **`ui-hide-without-route-guard`** — `*ngIf="isAdmin"` is the only gate.
5. **`client-side-permission-flag-in-state`** — store holds an unverified
   `isAdmin` flag.

## Remediation

### Always guard the route, not just the menu

```ts
// Bad
{ path: 'administration', component: AdminComponent }

// Good
{ path: 'administration', component: AdminComponent, canActivate: [AdminGuard] }

// AdminGuard MUST call the server, not read localStorage
@Injectable({ providedIn: 'root' })
export class AdminGuard {
  constructor(private http: HttpClient, private router: Router) {}
  canActivate() {
    return this.http.get<{ role: string }>('/api/whoami').pipe(
      map(u => u.role === 'admin' || this.router.parseUrl('/login'))
    );
  }
}
```

### Lazy-loaded modules need canLoad

```ts
// Bad
{ path: 'web3-sandbox', loadChildren: () => import('./web3') }

// Good
{ path: 'web3-sandbox', canLoad: [BetaFeatureGuard], loadChildren: () => import('./web3') }
```

### Server-side check is the only check that counts

Every UI guard MUST be paired with an API-level authorization check on the
endpoints that route eventually calls. The browser cannot enforce
authorization; only the server can.

After each fix, re-run `zerou audit` and confirm zero findings on this preset.
