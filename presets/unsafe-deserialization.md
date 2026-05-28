---
id: unsafe-deserialization
version: 2
name: Unsafe deserialization check (yaml, vm, bson, xml2js)
appliesTo: ['saas-web', 'api-service', 'library']
rules:
  - ruleId: yaml-load-unsafe
    label: yaml.load() called (deprecated unsafe loader)
    severity: P1
    mechanism: static-grep
    source: unsafe-deserialization/v2
    rationale: In js-yaml < 4, yaml.load() used the unsafe schema and would deserialize the !!js/function tag — instant RCE on attacker input. v4 made it safe, but legacy code on v3 is widespread. The safe path is yaml.load with SAFE_SCHEMA or the explicit safeLoad in v3.
    detection:
      pattern: \byaml\.load\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: upgrade js-yaml to >=4 OR use yaml.safeLoad / yaml.load(text, { schema: yaml.SAFE_SCHEMA }). Never load untrusted YAML with the default schema on v3.'"
      verifyCommand: "! grep -rE '\\byaml\\.load\\s*\\(' src/"
  - ruleId: js-yaml-unsafe-load
    label: require('js-yaml').load without explicit safe schema
    severity: P1
    mechanism: static-grep
    source: unsafe-deserialization/v2
    rationale: Same risk class as yaml-load-unsafe but matches the inline require pattern. Even on js-yaml v4, explicitly passing { schema: yaml.FAILSAFE_SCHEMA } documents intent and resists future regressions.
    detection:
      pattern: require\s*\(\s*['"]js-yaml['"]\s*\)\.load\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: use yaml.load(text, { schema: yaml.SAFE_SCHEMA }) or upgrade to js-yaml >=4 where default is safe.'"
      verifyCommand: "! grep -rE 'require\\s*\\(\\s*[\\\"'\\'']js-yaml[\\\"'\\'']\\s*\\)\\.load\\s*\\(' src/"
  - ruleId: xml2js-explicitArray-false-no-validation
    label: xml2js parseString called on user input without validation
    severity: P2
    mechanism: static-grep
    source: unsafe-deserialization/v2
    rationale: xml2js with default config and untrusted input lets the attacker reshape the parsed object — keys like __proto__ appear in some configurations. Combined with downstream merges this becomes prototype pollution. Validate the resulting object shape before use.
    detection:
      pattern: (?:xml2js\.parseString|parseString)\s*\(\s*(req\.|input|params|body|query)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: validate the parsed XML against a schema (zod, joi) before any downstream use. Set explicitArray:false carefully — confirm prototype keys cannot reach merges.'"
      verifyCommand: "! grep -rE '(xml2js\\.parseString|parseString)\\s*\\(\\s*(req\\.|input|params|body|query)' src/"
  - ruleId: bson-parse-no-validation
    label: BSON.deserialize called on user-controlled buffer
    severity: P2
    mechanism: static-grep
    source: unsafe-deserialization/v2
    rationale: BSON.deserialize on untrusted bytes has historically produced objects with non-string keys, ObjectId injection, and out-of-bounds reads in older bson versions. Validate the buffer size and resulting shape; pin a current bson version.
    detection:
      pattern: (?:BSON|bson)\.(?:deserialize|parse)\s*\(\s*(req\.|input|params|body|query|buffer)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: cap input size, validate the deserialized object with a schema, and ensure bson is on a current version (>=4.7).'"
      verifyCommand: "! grep -rE '(BSON|bson)\\.(deserialize|parse)\\s*\\(\\s*(req\\.|input|params|body|query|buffer)' src/"
  - ruleId: vm-untrusted-context
    label: node:vm context built from user input
    severity: P1
    mechanism: static-grep
    source: unsafe-deserialization/v2
    rationale: node:vm is documented as NOT a security boundary. createContext(req.body) lets the attacker inject globals; runInContext(req.body) runs attacker-supplied JS. Escapes from vm sandboxes are trivial — multiple public PoCs exist.
    detection:
      pattern: vm\.(?:createContext|runInContext|runInNewContext|runInThisContext)\s*\(\s*(req\.|input|params|body|query)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: do not use node:vm to sandbox untrusted code. Use isolated-vm or run in a separate process with seccomp / cgroup / container limits.'"
      verifyCommand: "! grep -rE 'vm\\.(createContext|runInContext|runInNewContext|runInThisContext)\\s*\\(\\s*(req\\.|input|params|body|query)' src/"
  - ruleId: json-parse-no-try
    label: JSON.parse on user input without try/catch
    severity: P3
    mechanism: static-grep
    source: unsafe-deserialization/v2
    rationale: JSON.parse throws SyntaxError on malformed input. Without try/catch a single bad request crashes the request handler — and on older Node versions can crash the whole process. Not RCE but a denial-of-service quality issue.
    detection:
      pattern: JSON\.parse\s*\(\s*(req\.|input|params|body|query)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: wrap JSON.parse in try/catch and return a 400 on SyntaxError. Better, use a schema validator (zod safeParse) that handles both parse + shape errors.'"
      verifyCommand: "! grep -rE 'JSON\\.parse\\s*\\(\\s*(req\\.|input|params|body|query)' src/"
  - ruleId: safer-json-parse-needed
    label: JSON.parse output reaches property access without schema validation
    severity: P2
    mechanism: llm-judgment
    source: unsafe-deserialization/v2
    rationale: const data = JSON.parse(body); db.find({ id: data.userId }) treats every property as already-validated. Type assumptions break — userId could be an object, an array, or have prototype pollution. LLM judges whether a schema validator (zod, joi, ajv) gates the downstream access.
    detection:
      pattern: JSON\.parse\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: pipe JSON.parse output through a schema validator before any property access. zod.parse / joi.validate / ajv compile-then-validate are the standard choices.'"
      verifyCommand: "echo 'manual review required — confirm schema validation exists between JSON.parse and downstream use'"
---

# Unsafe deserialization check

Parsers that interpret tags, types, or function literals turn data into
code. YAML, BSON, XML, and node:vm all have historical or current foot-guns
in this class.

Seven sinks:

1. **`yaml-load-unsafe`** — js-yaml v3 yaml.load() deserializes !!js/function.
2. **`js-yaml-unsafe-load`** — same risk via require('js-yaml') inline.
3. **`xml2js-explicitArray-false-no-validation`** — unvalidated parsed XML.
4. **`bson-parse-no-validation`** — BSON.deserialize on untrusted bytes.
5. **`vm-untrusted-context`** — node:vm with user input.
6. **`json-parse-no-try`** — JSON.parse without try/catch is a DoS.
7. **`safer-json-parse-needed`** — JSON.parse output used without schema validation (LLM-judged).

## Remediation

### YAML — use safe load

```js
import yaml from 'js-yaml';

// Bad (v3)
const config = yaml.load(text);

// Good
const config = yaml.load(text, { schema: yaml.SAFE_SCHEMA });
// or upgrade to js-yaml v4 where default is safe
```

### vm — do not sandbox untrusted code with it

```js
// Bad
vm.runInNewContext(req.body.code);

// Good — use isolated-vm
import ivm from 'isolated-vm';
const isolate = new ivm.Isolate({ memoryLimit: 8 });
const context = await isolate.createContext();
```

### JSON — validate with a schema

```js
import { z } from 'zod';
const Body = z.object({ userId: z.string().uuid(), amount: z.number().positive() });

const parsed = Body.safeParse(JSON.parse(req.body));
if (!parsed.success) return res.status(400).end();
```

After fixes, re-run `zerou audit` and confirm zero findings remain.
