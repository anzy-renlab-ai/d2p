---
id: logic-bug-control-flow
version: 2
name: Logic bugs — control flow / return / switch / branch
appliesTo: []
rules:
  - ruleId: if-no-return-no-else
    label: "`if (err) cb(err);` pattern without `return` (success path still runs)"
    severity: P1
    mechanism: static-grep
    source: logic-bug-control-flow/v2
    rationale: "`if (err) cb(err);` (no return, no else) lets the success path continue with err set and data undefined. Karma reporter Bug-3 (line 99), Mongoose document Bug-8 (line 355), and Express utils Bug-5 are exactly this shape — the BugsJS fixes add the missing `return`."
    detection:
      pattern: ^\s*if\s*\(\s*err\b[^)]*\)\s+[a-zA-Z_$][a-zA-Z0-9_$.]*\s*\(
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: write `if (err) return cb(err);` — always return after invoking the error callback so the success path does not run with err set.'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: missing-default-in-switch
    label: "switch statement without a default clause"
    severity: P2
    mechanism: llm-judgment
    source: logic-bug-control-flow/v2
    rationale: "A switch with no `default` silently no-ops on unknown input; bugs hide in the gap between enumerated values. ESLint's `default-case` rule codifies this. BugsJS has multiple 'missing input validation' bugs that map here (eslint no-obj-calls Bug-1 narrows recognised identifiers to Math/JSON, missing Reflect)."
    detection:
      pattern: \bswitch\s*\(
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: llm-only
      command: "echo 'manual remediation: add a `default:` clause that either logs the unknown case or throws. Silent no-op is a recipe for missing-input bugs.'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: condition-checks-only-known-values
    label: "Equality chain restricting to small enumeration (likely missing case)"
    severity: P2
    mechanism: static-grep
    source: logic-bug-control-flow/v2
    rationale: "Patterns like `if (name === 'Math' || name === 'JSON')` (ESLint no-obj-calls Bug-1 line 31) frequently miss a sibling that the fix later adds (`Reflect`, `Atomics`). When an equality chain encodes a known-good set, surface it for a 'missing case' review."
    detection:
      pattern: \b(name|type|kind|tag|key|op)\s*===\s*['"`][A-Z][a-zA-Z]*['"`]\s*\|\|\s*[a-zA-Z_$][a-zA-Z0-9_$.]*\s*===\s*['"`][A-Z]
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: llm-only
      command: "echo 'manual remediation: extract the allow-list to a const Set or array, so adding a member is a one-liner and intent is explicit. Then audit whether the set is complete (Math/JSON/Reflect/Atomics for non-callable globals).'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: function-prototype-no-return
    label: "`Constructor.prototype.method = function ... { ... }` with no return statement at body end"
    severity: P2
    mechanism: llm-judgment
    source: logic-bug-control-flow/v2
    rationale: "Mongoose Document Bug-8 (`Document.prototype.update`, line 355) shows the canonical case: the wrapper invokes the underlying call but does not `return` it, so chainable `.exec()` callers get undefined. Surface prototype methods that delegate-without-returning for review."
    detection:
      pattern: \.prototype\.[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*function
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: llm-only
      command: "echo 'manual remediation: when a prototype method delegates (this.x.apply(this.x, args)), return that call so the chain works — return this.constructor.update.apply(this.constructor, args);'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: early-return-without-cleanup
    label: "`return` from try-body without finally / close in the same scope"
    severity: P2
    mechanism: static-grep
    source: logic-bug-control-flow/v2
    rationale: "Returning from inside a `try` that opened a resource (stream, fd, lock) without a `finally` to release it leaks the resource. BugsJS has multiple resource-cleanup fixes in karma / hexo IO paths."
    detection:
      pattern: try\s*\{[^}]*\breturn\b
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: llm-only
      command: "echo 'manual remediation: pair every try-with-return with finally { close(resource); }, or use using / await using in modern TS.'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: callback-without-return-on-error
    label: "Node-style callback (err, data) handler that does not return after err"
    severity: P1
    mechanism: static-grep
    source: logic-bug-control-flow/v2
    rationale: "`function(err, data) { if (err) cb(err); use(data); }` runs `use(data)` even on error because the if-branch did not return. Karma reporter Bug-3 (missing return at line 99) and Express utils Bug-5 are this shape."
    detection:
      pattern: function\s*\(\s*err\s*,\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\)\s*\{[^}]*\bif\s*\(\s*err\s*\)\s*[a-zA-Z_$]
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: write `if (err) return cb(err);` — always return after invoking the error callback so the success path does not run on undefined data.'"
      verifyCommand: "echo 'manual review required'"
---

# Logic bugs — control flow / return / switch / branch

Six patterns for the BugsJS "missing return / missing case" bug family.
Mongoose Document Bug-8 and Karma reporter Bug-3 are the canonical
missing-return examples; ESLint no-obj-calls Bug-1 is the canonical
missing-case.

1. **`if-no-return-no-else`** — `if (err) cb(err);` without return;
   success path runs with err set.
2. **`missing-default-in-switch`** — switch without default clause.
3. **`condition-checks-only-known-values`** — `x === 'A' || x === 'B'`
   allow-list that likely misses C.
4. **`function-prototype-no-return`** — `X.prototype.method = function`
   that delegates without returning the chained call.
5. **`early-return-without-cleanup`** — return from try-body without a
   finally to release resources.
6. **`callback-without-return-on-error`** — node callback that runs
   the success path even when err is set.

## Remediation patterns

```js
// Bad — fall-through to default
switch (op) {
  case 'add': total += x;
  case 'sub': total -= x; break;
}

// Good
switch (op) {
  case 'add': total += x; break;
  case 'sub': total -= x; break;
  default: throw new Error('unknown op ' + op);
}
```

```js
// Bad — runs even on error
fs.readFile(p, function (err, data) {
  if (err) cb(err);
  cb(null, data.toString());
});

// Good
fs.readFile(p, function (err, data) {
  if (err) return cb(err);
  cb(null, data.toString());
});
```

After applying fixes, re-run `zerou audit` and confirm zero findings remain.
