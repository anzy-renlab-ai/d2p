---
id: dynamic-require
version: 2
name: Dynamic require / import check (npm ecosystem)
appliesTo: ['saas-web', 'api-service', 'library']
rules:
  - ruleId: require-from-variable
    label: require() called with a non-literal expression
    severity: P1
    mechanism: static-grep
    source: dynamic-require/v2
    rationale: require(variable) lets an attacker that controls the variable load any installed module — including child_process for full RCE, or fs for arbitrary file read. Static analyzers and bundlers also fail on dynamic requires, hiding the vulnerability from review.
    detection:
      pattern: \brequire\s*\(\s*(?!['"`])
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace require(variable) with an explicit allow-list map: const mods = { foo: require(\"./foo\"), bar: require(\"./bar\") }; const m = mods[key];'"
      verifyCommand: "! grep -rE '\\brequire\\s*\\(\\s*(?![`'\\''\"])' src/"
  - ruleId: import-from-variable
    label: dynamic import() with template-literal interpolation
    severity: P1
    mechanism: static-grep
    source: dynamic-require/v2
    rationale: import(`./plugins/${name}`) with user-controlled name allows path-traversal-style module loads (./plugins/../../child_process.js). Equivalent to dynamic require but harder to spot during review because ESM looks safer.
    detection:
      pattern: \bimport\s*\(\s*`[^`]*\$\{
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace dynamic import() with a static map of allowed modules. If lazy loading is needed, use a switch over a fixed allow-list of plugin names.'"
      verifyCommand: "! grep -rE '\\bimport\\s*\\(\\s*`[^`]*\\$\\{' src/"
  - ruleId: module-load-from-user-path
    label: Module loader called with user-controlled name
    severity: P1
    mechanism: llm-judgment
    source: dynamic-require/v2
    rationale: Plugin systems, lazy-loaders, and adapter patterns often call require, import, or a custom loader with a name routed from req.params.plugin or req.body.type. LLM traces data flow from the request boundary to the loader to confirm an allow-list gate exists between them.
    detection:
      pattern: (?:loadModule|loadPlugin|require|import|loader)\s*\(\s*\w+\s*\)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: insert an allow-list check between the request boundary and the loader. const ALLOWED = new Set([\"a\",\"b\"]); if (!ALLOWED.has(name)) throw new BadRequest();'"
      verifyCommand: "echo 'manual review required — confirm allow-list gate exists between request input and module loader'"
  - ruleId: node-resolve-user-input
    label: require.resolve called with user-controlled path
    severity: P2
    mechanism: static-grep
    source: dynamic-require/v2
    rationale: require.resolve doesn't execute code but does walk the node_modules tree and the file system. With user input it leaks installed package names, reveals project layout, and on some Node versions triggers symlink dereferencing — useful reconnaissance for an attacker preparing a follow-up exploit.
    detection:
      pattern: require\.resolve\s*\(\s*(?:req|input|params|body|query)\b
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: do not call require.resolve with user input. If the user must pick a plugin, validate the name against an allow-list before resolution.'"
      verifyCommand: "! grep -rE 'require\\.resolve\\s*\\(\\s*(req|input|params|body|query)\\b' src/"
  - ruleId: createRequire-from-user-input
    label: createRequire() called with user-controlled URL
    severity: P2
    mechanism: static-grep
    source: dynamic-require/v2
    rationale: createRequire(url) builds a require function rooted at the provided URL — letting an attacker who controls the URL resolve modules against an unexpected node_modules tree. Combined with require(variable) downstream, that's RCE.
    detection:
      pattern: createRequire\s*\(\s*(?:req|input|params|body|query)\b
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: pass a fixed import.meta.url or a hardcoded path to createRequire. Never route user input into the base URL.'"
      verifyCommand: "! grep -rE 'createRequire\\s*\\(\\s*(req|input|params|body|query)\\b' src/"
---

# Dynamic require / import check

JavaScript's module loader can resolve any package, including the standard
library. require(variable) and import(variable) bridge data into code: if
the variable is attacker-controlled, the attacker chooses which module
gets loaded — and child_process or fs are right there.

Five sinks:

1. **`require-from-variable`** — `require(x)` where x is not a literal.
2. **`import-from-variable`** — `import(\`./plugins/${x}\`)`.
3. **`module-load-from-user-path`** — wrapper loader with user input (LLM-judged).
4. **`node-resolve-user-input`** — `require.resolve(req.body.x)`.
5. **`createRequire-from-user-input`** — base URL from user input.

## Remediation

### Static allow-list

```js
// Bad
const handler = require(req.params.handler);

// Good
const HANDLERS = {
  upload: require('./handlers/upload.js'),
  download: require('./handlers/download.js'),
};
const handler = HANDLERS[req.params.handler];
if (!handler) return res.status(404).end();
```

### Static dynamic-import allow-list

```js
const PLUGINS = ['resize', 'rotate', 'crop'];
if (!PLUGINS.includes(name)) return res.status(400).end();
const mod = await import(`./plugins/${name}.js`);
```

After fixes, re-run `zerou audit` and confirm zero findings remain.
