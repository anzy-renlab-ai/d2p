---
id: secrets-leak
version: 2
name: Secrets leakage check (vibe-coded apps)
appliesTo: []
rules:
  - ruleId: stripe-live-key
    label: Hardcoded Stripe live secret key detected
    severity: P1
    mechanism: static-grep
    source: secrets-leak/v2
    rationale: Live Stripe secret keys (sk_live_*) must never appear in source. They allow full charges against the production account.
    detection:
      pattern: sk_live_[A-Za-z0-9]{16,}
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation required: move Stripe key to environment variable STRIPE_SECRET_KEY'"
      verifyCommand: "! grep -rE 'sk_live_[A-Za-z0-9]{16,}' src/"
  - ruleId: aws-access-key-id
    label: Hardcoded AWS Access Key ID detected
    severity: P1
    mechanism: static-grep
    source: secrets-leak/v2
    rationale: AWS access key IDs match AKIA followed by 16 uppercase alphanumerics. Hardcoding them grants attackers full account access.
    detection:
      pattern: AKIA[0-9A-Z]{16}
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation required: move AWS credentials to environment variables / IAM role'"
      verifyCommand: "! grep -rE 'AKIA[0-9A-Z]{16}' src/"
  - ruleId: jwt-token
    label: Hardcoded JWT token detected
    severity: P2
    mechanism: static-grep
    source: secrets-leak/v2
    rationale: JWT tokens start with eyJhbGciOi (base64 of {"alg":"...). Tokens in source are usually long-lived and leak user identity.
    detection:
      pattern: eyJhbGciOi[A-Za-z0-9_-]{10,}
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation required: rotate the leaked JWT secret and source tokens at runtime'"
      verifyCommand: "! grep -rE 'eyJhbGciOi[A-Za-z0-9_-]{10,}' src/"
---

# Secrets leakage check

Vibe-coded apps frequently embed credentials directly in source. This preset
catches the three highest-impact patterns:

1. **Stripe live keys** (`sk_live_*`) — full production charge authority.
2. **AWS access key IDs** (`AKIA*`) — typically paired with a secret in the
   same file, granting infrastructure control.
3. **JWT tokens** (`eyJhbGciOi*`) — long-lived auth artifacts that bypass
   login flows.

## Remediation

1. Rotate the credential immediately (treat as compromised — git history is
   not scrubbed by this fix).
2. Move the value to an environment variable.
3. Reference the env var at runtime: `process.env.STRIPE_SECRET_KEY`.
4. Add the var to `.env.example` (without the value).
5. Confirm by re-running `zerou audit` and verifying zero findings remain.
