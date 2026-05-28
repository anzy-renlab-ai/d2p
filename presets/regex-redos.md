---
id: regex-redos
version: 2
name: ReDoS (catastrophic backtracking) check
appliesTo: ['saas-web', 'api-service', 'library']
rules:
  - ruleId: nested-quantifier-regex
    label: Regex contains nested quantifier (catastrophic backtracking risk)
    severity: P2
    mechanism: static-grep
    source: regex-redos/v2
    rationale: Patterns like (a+)+, (a*)*, (a|a)*, (.+)+ create exponential backtracking on near-match input. A 30-char attack string can hang the event loop for minutes, taking down a single-threaded Node process and every concurrent request.
    detection:
      pattern: \(\s*(?:\.|\\w|\\d|\\s|\\S|\[[^\]]+\]|[a-zA-Z])[+*]\s*\)\s*[+*]
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: rewrite the regex to avoid nested quantifiers. Use a possessive form, atomic group, or split into two non-overlapping passes. Validate with safe-regex or regexploit.'"
      verifyCommand: "! grep -rE '\\(\\s*(\\.|\\\\w|\\\\d|\\\\s|\\\\S|\\[[^\\]]+\\]|[a-zA-Z])[+*]\\s*\\)\\s*[+*]' src/"
  - ruleId: user-input-as-regex
    label: new RegExp built from user input
    severity: P1
    mechanism: static-grep
    source: regex-redos/v2
    rationale: new RegExp(req.body.pattern) lets an attacker submit their own regex — including known catastrophic patterns like (a+)+$ — and run it against any string the server tests with .test() or .match(). Result is a wall-clock DoS on a single request.
    detection:
      pattern: new\s+RegExp\s*\(\s*(?:req|input|params|body|query|untrusted)\b
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: never compile user input into a RegExp. Use string contains / startsWith / a parser, or pre-validate the pattern with a strict allow-list and a timeout.'"
      verifyCommand: "! grep -rE 'new\\s+RegExp\\s*\\(\\s*(req|input|params|body|query|untrusted)\\b' src/"
  - ruleId: regexp-template-literal-interpolation
    label: new RegExp with template-literal interpolation
    severity: P1
    mechanism: static-grep
    source: regex-redos/v2
    rationale: new RegExp(`^${variable}$`) is the same risk as direct user input when `variable` is downstream of req. Splicing arbitrary text into regex source also breaks the pattern via unescaped metacharacters (.,*,+,(,),[]).
    detection:
      pattern: new\s+RegExp\s*\(\s*`[^`]*\$\{
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: escape the value with a regex-escape helper before interpolation, or replace the regex with plain string operations.'"
      verifyCommand: "! grep -rE 'new\\s+RegExp\\s*\\(\\s*`[^`]*\\$\\{' src/"
  - ruleId: overly-broad-email-regex
    label: Classic catastrophic email regex .+@.+\\..+
    severity: P3
    mechanism: static-grep
    source: regex-redos/v2
    rationale: The naive .+@.+\\..+ email pattern is a well-known ReDoS gadget on inputs like "aaaa...@aaaa". It's also a poor email validator. Use a real validator (validator.isEmail, zod email) or RFC 5322 anchored pattern.
    detection:
      pattern: \.\+@\.\+\\\.\.\+
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace the .+@.+\\..+ regex with validator.isEmail() or zod string().email(). Both are linear-time and RFC-accurate.'"
      verifyCommand: "! grep -rE '\\.\\+@\\.\\+\\\\\\.\\.\\+' src/"
  - ruleId: catastrophic-backtrack-known
    label: Regex matches a known catastrophic pattern family
    severity: P2
    mechanism: llm-judgment
    source: regex-redos/v2
    rationale: Beyond the obvious nested-quantifier case, families like (a|aa)+, (a|a?)+, [a-z]+[a-z]*x, and overlapping alternations all backtrack catastrophically. LLM compares the regex against a curated catastrophic-pattern reference and flags matches.
    detection:
      pattern: new\s+RegExp\s*\(|\/.*[+*?].*[+*?].*\/[gimsuy]*
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: run safe-regex or regexploit against the file; rewrite flagged patterns with atomic groups or non-overlapping alternatives.'"
      verifyCommand: "echo 'manual review required — confirm regex passes safe-regex check'"
---

# ReDoS (catastrophic backtracking) check

A single bad regex can hang the Node event loop for minutes on attacker
input — a wall-clock DoS that scales linearly with attacker count and
saturates a single-threaded server fast.

Five surface patterns:

1. **`nested-quantifier-regex`** — `(.+)+`, `(a*)*`, classic exponential gadgets.
2. **`user-input-as-regex`** — `new RegExp(req.body.x)`.
3. **`regexp-template-literal-interpolation`** — `new RegExp(\`^${v}$\`)`.
4. **`overly-broad-email-regex`** — the famous `.+@.+\\..+` foot-gun.
5. **`catastrophic-backtrack-known`** — LLM-checked against the catastrophic family list.

## Remediation

### Run safe-regex during CI

```bash
npm install --save-dev safe-regex
node -e "console.log(require('safe-regex')(/^(a+)+$/))"  // false
```

### Replace nested quantifier with possessive form

```js
// Bad — (.+)+ backtracks exponentially
const re = /^(.+)+$/;

// Good — single quantifier, linear
const re = /^.+$/;
```

### Validate emails with a real library

```js
import validator from 'validator';
if (!validator.isEmail(input)) throw new BadRequest();
```

### Escape user input for regex use

```js
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const re = new RegExp(`^${escape(user)}$`);
```

After fixes, re-run `zerou audit` and confirm zero findings remain.
