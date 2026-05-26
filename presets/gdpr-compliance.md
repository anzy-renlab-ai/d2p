---
id: gdpr-compliance
version: 2
name: GDPR compliance baseline
appliesTo: []
rules:
  - ruleId: pii-collection-without-consent
    label: Endpoint collects personal data (email/phone/address) but no consent notice in repo
    severity: P1
    mechanism: llm-judgment
    source: gdpr-compliance/v2
    rationale: "GDPR Article 7 + Article 13 require informed consent before processing personal data. If endpoints accept email/phone/address fields but the repo has no privacy notice, cookie banner, or consent UI, the deployment is presumptively unlawful in the EU. Heuristic — grep for PII field names in route handlers; LLM judges whether a corresponding consent surface exists in the codebase."
    detection:
      pattern: "(req\\.body|req\\.query|formData)\\.(email|phone|address|firstName|lastName|fullName|dob|birthdate|ssn|nationalId)"
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation required: add a privacy-notice page (PRIVACY.md / /privacy route), a consent checkbox on PII-collecting forms, and a cookie banner if you set non-essential cookies'"
      verifyCommand: "test -f PRIVACY.md -o -f privacy.md -o -f docs/PRIVACY.md -o -e src/pages/privacy.tsx -o -e src/app/privacy/page.tsx"
  - ruleId: missing-data-export-endpoint
    label: GDPR Article 20 — no data export / portability endpoint
    severity: P2
    mechanism: file-exists
    source: gdpr-compliance/v2
    rationale: "GDPR Article 20 grants users the right to receive their personal data in a structured, machine-readable format. Apps processing EU user data must expose an export endpoint (e.g. GET /api/me/export) or equivalent admin-mediated process documented in PRIVACY.md."
    detection:
      paths:
        - src/pages/api/me/export.ts
        - src/pages/api/user/export.ts
        - src/app/api/me/export/route.ts
        - src/app/api/user/export/route.ts
        - src/routes/export-my-data.ts
        - src/routes/user-export.ts
      expect: present
    fix:
      kind: template
      command: "echo 'manual remediation required: implement GET /api/me/export returning JSON of all user-linked rows; or document admin export procedure in PRIVACY.md'"
      verifyCommand: "test -f src/pages/api/me/export.ts -o -f src/app/api/me/export/route.ts -o -f src/routes/export-my-data.ts -o -f src/pages/api/user/export.ts"
  - ruleId: missing-delete-account-endpoint
    label: GDPR Article 17 — no account deletion endpoint
    severity: P1
    mechanism: file-exists
    source: gdpr-compliance/v2
    rationale: "GDPR Article 17 (right to erasure) requires users to be able to delete their personal data. Apps must expose DELETE /api/user/me (or equivalent) and document the cascade — purging or anonymising related rows."
    detection:
      paths:
        - src/pages/api/user/me.ts
        - src/pages/api/me/delete.ts
        - src/app/api/user/me/route.ts
        - src/app/api/me/route.ts
        - src/routes/delete-account.ts
        - src/routes/user-delete.ts
      expect: present
    fix:
      kind: template
      command: "echo 'manual remediation required: implement DELETE /api/user/me with cascade purge (or anonymise) of related rows; document retention period in PRIVACY.md'"
      verifyCommand: "test -f src/pages/api/user/me.ts -o -f src/app/api/user/me/route.ts -o -f src/routes/delete-account.ts -o -f src/pages/api/me/delete.ts"
  - ruleId: third-party-analytics-no-opt-out
    label: Third-party analytics (GA / Mixpanel / etc.) loaded without opt-out hook
    severity: P2
    mechanism: llm-judgment
    source: gdpr-compliance/v2
    rationale: "ePrivacy Directive + GDPR require explicit opt-in for non-essential cookies and analytics in the EU. If GA / Mixpanel / Segment / PostHog is loaded unconditionally (no consent gate, no opt-out toggle), the deployment is non-compliant. LLM judges whether the analytics init is wrapped in a consent check."
    detection:
      pattern: "(gtag|googletagmanager|google-analytics|mixpanel|segment\\.io|posthog|amplitude|hotjar|clarity\\.ms)"
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs,html}
    fix:
      kind: llm-only
      command: "echo 'manual remediation required: wrap analytics init in a consent check (cookieConsent.granted) and expose a /settings/privacy opt-out toggle'"
      verifyCommand: "grep -rEn '(consent|cookieConsent|gdprConsent|optOut|optIn)' src/"
  - ruleId: cookie-missing-secure-flags
    label: Cookie set without secure + httpOnly + sameSite
    severity: P1
    mechanism: static-grep
    source: gdpr-compliance/v2
    rationale: "Session cookies must set secure=true (HTTPS-only), httpOnly=true (no JS access), and sameSite=lax|strict (CSRF defence). Missing any flag exposes sessions to network sniffing, XSS theft, or cross-site request forgery — also a GDPR Article 32 (security of processing) violation."
    detection:
      pattern: "res\\.cookie\\s*\\(|cookies\\.set\\s*\\(|setCookie\\s*\\("
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation required: add { secure: true, httpOnly: true, sameSite: lax } to every cookie set; in dev use NODE_ENV check if HTTPS unavailable locally'"
      verifyCommand: "! grep -rEn 'res\\.cookie\\s*\\(|cookies\\.set\\s*\\(' src/ | grep -v -E 'secure.*httpOnly|httpOnly.*secure'"
---

# GDPR compliance baseline

Five rules covering the minimum GDPR / ePrivacy posture for a public-facing
app handling EU users. Not a substitute for legal review — but catches the
patterns that get apps fined within days of launch.

## Five rules

1. **`pii-collection-without-consent`** — endpoints accepting email / phone
   / address fields without a privacy notice / consent surface in the repo.
2. **`missing-data-export-endpoint`** — no Article 20 portability endpoint.
3. **`missing-delete-account-endpoint`** — no Article 17 erasure endpoint.
4. **`third-party-analytics-no-opt-out`** — analytics SDK loaded
   unconditionally with no consent gate.
5. **`cookie-missing-secure-flags`** — cookies set without
   `secure + httpOnly + sameSite`.

## Remediation

```ts
// Cookies (Express)
res.cookie('session', token, {
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
```

```ts
// Article 17 — delete account
// src/app/api/user/me/route.ts
export async function DELETE(req: Request) {
  const userId = await requireAuth(req);
  await db.$transaction([
    db.session.deleteMany({ where: { userId } }),
    db.post.updateMany({ where: { userId }, data: { userId: null, authorName: 'deleted' } }),
    db.user.delete({ where: { id: userId } }),
  ]);
  return Response.json({ status: 'deleted' });
}
```

```ts
// Article 20 — export
export async function GET(req: Request) {
  const userId = await requireAuth(req);
  const payload = {
    user: await db.user.findUnique({ where: { id: userId } }),
    posts: await db.post.findMany({ where: { userId } }),
    /* ... every table linked to userId ... */
  };
  return Response.json(payload, { headers: { 'Content-Disposition': 'attachment; filename="my-data.json"' } });
}
```

```ts
// Analytics consent gate
if (cookieConsent.granted('analytics')) {
  loadGoogleAnalytics();
}
```

Re-run `zerou audit` after each fix; the verify commands must exit 0.
