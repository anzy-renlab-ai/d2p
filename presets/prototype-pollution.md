---
id: prototype-pollution
version: 2
name: Prototype pollution check (npm ecosystem)
appliesTo: ['saas-web', 'api-service', 'library']
rules:
  - ruleId: object-assign-user-input
    label: Object.assign with user-controlled source object
    severity: P1
    mechanism: static-grep
    source: prototype-pollution/v2
    rationale: Object.assign({}, req.body) walks every enumerable key on the source — including __proto__, constructor, and prototype — and copies them onto the target. With a crafted body the attacker mutates Object.prototype globally, affecting every later object lookup in the process.
    detection:
      pattern: Object\.assign\s*\(\s*[^,]+,\s*(req\.|input|params|body|query|untrusted)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: do not pass untrusted objects to Object.assign. Allow-list keys explicitly: for (const k of [\"name\",\"email\"]) target[k] = src[k];'"
      verifyCommand: "! grep -rE 'Object\\.assign\\s*\\(\\s*[^,]+,\\s*(req\\.|input|params|body|query|untrusted)' src/"
  - ruleId: lodash-set-user-key
    label: lodash.set / _.set with user-controlled path
    severity: P1
    mechanism: static-grep
    source: prototype-pollution/v2
    rationale: lodash.set(obj, path, value) walks the path tokens and creates intermediate objects. A path like "__proto__.polluted" or "constructor.prototype.polluted" reaches Object.prototype. Versions before 4.17.20 are also unpatched; the safer pattern is to forbid user-controlled paths entirely.
    detection:
      pattern: (?:_\.set|lodash\.set|set)\s*\(\s*[^,]+,\s*(req\.|input|params|body|query)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: never feed user input as the path argument to lodash.set. Use a hardcoded path or switch to a flat assignment with key allow-list.'"
      verifyCommand: "! grep -rE '(_\\.set|lodash\\.set|set)\\s*\\(\\s*[^,]+,\\s*(req\\.|input|params|body|query)' src/"
  - ruleId: lodash-defaultsDeep
    label: lodash.defaultsDeep / _.merge with user-controlled source
    severity: P1
    mechanism: static-grep
    source: prototype-pollution/v2
    rationale: defaultsDeep and merge perform recursive key-by-key copy. If the source is user input, keys named __proto__ or constructor.prototype reach Object.prototype. Lodash < 4.17.20 has known CVEs; even patched versions are dangerous with untrusted input.
    detection:
      pattern: (?:_\.defaultsDeep|_\.merge|lodash\.defaultsDeep|lodash\.merge|defaultsDeep|merge)\s*\(\s*[^,]+,\s*(req\.|input|params|body|query)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: validate the source object with a schema (zod, joi, ajv) before any deep merge. Reject keys __proto__, constructor, prototype outright.'"
      verifyCommand: "! grep -rE '(_\\.defaultsDeep|_\\.merge|lodash\\.defaultsDeep|lodash\\.merge|defaultsDeep|merge)\\s*\\(\\s*[^,]+,\\s*(req\\.|input|params|body|query)' src/"
  - ruleId: recursive-merge-no-proto-check
    label: Custom recursive merge function without __proto__ / constructor guard
    severity: P2
    mechanism: llm-judgment
    source: prototype-pollution/v2
    rationale: Hand-rolled deep-merge / extend / clone helpers frequently iterate Object.keys without filtering __proto__ or constructor. LLM reviews the function body to confirm it explicitly rejects those keys or uses Object.create(null) for accumulators before flagging.
    detection:
      pattern: function\s+\w*(?:merge|extend|deepCopy|deepClone|assign)\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: add a guard at the top of the recursion: if (key === \"__proto__\" || key === \"constructor\" || key === \"prototype\") continue;'"
      verifyCommand: "echo 'manual review required — confirm proto guard exists in every recursive merge function'"
  - ruleId: json-merge-user-keys
    label: Object.entries / for-in loop copies user keys onto target
    severity: P2
    mechanism: llm-judgment
    source: prototype-pollution/v2
    rationale: Patterns like Object.entries(req.body).forEach(([k,v]) => target[k] = v) or for (const k in req.body) target[k] = req.body[k] copy attacker-controlled keys directly. Without an allow-list this is prototype pollution by the inherited-key edge case (for-in walks inherited keys too).
    detection:
      pattern: (?:Object\.entries|Object\.keys|for\s*\(\s*(?:const|let|var)\s+\w+\s+in)\s*\(?\s*(req\.|input|params|body|query)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: replace the loop with an explicit allow-list: const allowed = [\"name\",\"email\"]; for (const k of allowed) if (k in src) target[k] = src[k];'"
      verifyCommand: "echo 'manual review required — confirm key allow-list exists'"
---

# Prototype pollution check

JavaScript objects inherit from Object.prototype. Any write to that shared
prototype affects every later property lookup in the process — a single
polluted key can change auth checks, template rendering, or feature flags
across the whole app.

The five reachable sinks:

1. **`object-assign-user-input`** — Object.assign copies enumerable keys including __proto__.
2. **`lodash-set-user-key`** — `_.set(obj, "__proto__.x", 1)` is a one-liner exploit.
3. **`lodash-defaultsDeep`** — recursive merge walks into prototype.
4. **`recursive-merge-no-proto-check`** — home-grown deep merge without a guard.
5. **`json-merge-user-keys`** — naive key-by-key copy loops.

## Remediation

### Reject dangerous keys

```js
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
function safeMerge(target, src) {
  for (const k of Object.keys(src)) {
    if (FORBIDDEN.has(k)) continue;
    target[k] = src[k];
  }
}
```

### Use Object.create(null)

```js
// Bad — inherits from Object.prototype
const cache = {};

// Good — prototype-less, pollution-immune
const cache = Object.create(null);
```

### Validate with a schema

```js
import { z } from 'zod';
const Body = z.object({ name: z.string(), email: z.string().email() }).strict();
const data = Body.parse(req.body);
```

After fixes, re-run `zerou audit` and confirm zero findings remain.
