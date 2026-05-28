---
id: logic-bug-nullable
version: 2
name: Logic bugs — nullable / falsy default mishandling
appliesTo: []
rules:
  - ruleId: falsy-default-with-or
    label: "`options.x || default` discards valid 0 / '' / false inputs"
    severity: P2
    mechanism: static-grep
    source: logic-bug-nullable/v2
    rationale: "`var n = options.count || 10;` looks correct but silently rewrites legitimate values `0`, `''`, `false`, and `null` to the default. Hexo's paginator BugsJS Bug-9 (`current || this.current || 0`) and `toc` Bug-7 (`options.list_number || true`) both fall into this trap — passing 0 silently jumps to default. Prefer `options.hasOwnProperty('x') ? options.x : default` or `??`."
    detection:
      pattern: \b(options|opts|config|args|params|input|cfg|settings)\.[a-zA-Z_$][a-zA-Z0-9_$]*\s*\|\|\s*
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: replace `options.x || default` with `options.hasOwnProperty(\"x\") ? options.x : default` or `options.x ?? default`. 0/false/empty-string are valid inputs that `||` silently rewrites.'"
      verifyCommand: "echo 'manual review required — confirm 0/false/empty-string handling matches intent'"
  - ruleId: falsy-default-method-result
    label: "Method-call result OR'd with a default (silent 0 / '' rewrite)"
    severity: P3
    mechanism: static-grep
    source: logic-bug-nullable/v2
    rationale: "Patterns like `path.replace(...) || '/'` (Karma watcher Bug-9 line 11), `node.properties || node.elements` (ESLint comma-dangle Bug-7), or `input.split(',')[0] || 'default'` silently rewrite empty-string / 0 / false results. When the method's empty return is meaningful, `||` masks it."
    detection:
      pattern: \.(replace|trim|split|filter|find|match|exec|toString)\s*\([^)]*\)\s*\|\|\s*['"`0-9\[\{]
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: when an empty result is meaningful (empty string after trim / replace, no match from find), use `??` or an explicit length/undefined check rather than `||`.'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: falsy-default-this-prop
    label: "`this.prop || default` chain may discard valid falsy state"
    severity: P3
    mechanism: static-grep
    source: logic-bug-nullable/v2
    rationale: "Patterns like `options.current || this.current || 0` (hexo paginator BugsJS Bug-9) double-down on the `||` mistake: every level rewrites 0 / false / '' to the next fallback. Use `??` chains for nullish handling, or be explicit with `hasOwnProperty` / `=== undefined` checks."
    detection:
      pattern: \bthis\.[a-zA-Z_$][a-zA-Z0-9_$]*\s*\|\|\s*[a-zA-Z_$0-9'"`\[]
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: replace `this.x || default` with `this.x ?? default` so the default only triggers on null/undefined.'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: non-null-after-find
    label: ".find() result accessed without checking for undefined"
    severity: P1
    mechanism: static-grep
    source: logic-bug-nullable/v2
    rationale: "`arr.find(p).foo` throws `Cannot read properties of undefined` when no element matches. BugsJS shows multiple bug fixes that introduced a null-check on a search-style result. Always assign first, then guard."
    detection:
      pattern: \.find\s*\([^)]*\)\.[a-zA-Z_$]
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: const hit = arr.find(p); if (!hit) return; use hit.foo — never chain a property access onto find()`s result.'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: optional-chain-then-mutate
    label: "Optional chain on left side of a write / call expecting effect"
    severity: P2
    mechanism: static-grep
    source: logic-bug-nullable/v2
    rationale: "`obj?.list.push(x)` silently no-ops when `obj` is nullish — the caller assumes the push happened. Common in BugsJS-style data-processing bugs where a guard is added but the action is silently skipped."
    detection:
      pattern: \?\.[a-zA-Z_$][a-zA-Z0-9_$]*\.(push|unshift|splice|set|add|delete|emit|trigger)\s*\(
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: branch explicitly — if (!obj) { /* handle missing */ } else obj.list.push(x);'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: hasownproperty-mixed-with-or
    label: "`hasOwnProperty(...) ? a : b` next to plain `||` default for same input"
    severity: P3
    mechanism: static-grep
    source: logic-bug-nullable/v2
    rationale: "When one option uses the safe `hasOwnProperty` guard but a sibling uses `||`, the inconsistency typically means the second silently rewrites 0 / false / '' (hexo paginator Bug-9, toc Bug-7). Inconsistent option handling is a known correctness smell."
    detection:
      pattern: hasOwnProperty\s*\(\s*['"`]
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: audit every option in the same destructure — either all use hasOwnProperty (or ??) or all use ||. Mixed handling means at least one silently mutes 0/false/empty-string.'"
      verifyCommand: "echo 'manual review required'"
---

# Logic bugs — nullable / falsy default mishandling

Five patterns capture the BugsJS-flavour "input quietly mutated to the
default" bug. Hexo, Mongoose, and Karma all carry instances.

1. **`falsy-default-with-or`** — `options.x || default` rewrites 0 / ''
   / false to default (hexo `paginator` Bug-9, `toc` Bug-7, Karma
   `proxy` Bug-2).
2. **`falsy-default-this-prop`** — chained `||` on `this.x` defaults.
3. **`non-null-after-find`** — `.find(p).foo` crashes when search
   misses (Mongoose document Bug-9-class bugs).
4. **`optional-chain-then-mutate`** — `obj?.list.push(x)` silently
   no-ops; caller assumes mutation happened.
5. **`hasownproperty-mixed-with-or`** — inconsistent option handling
   in the same destructure block usually means at least one option
   silently mutes the 0 / false case.

## Remediation patterns

```js
// Bad — 0 collapses to 10
var n = options.count || 10;

// Good — preserve 0
var n = options.hasOwnProperty('count') ? options.count : 10;
// Or, modern JS
var n = options.count ?? 10;
```

```js
// Bad — find may return undefined
return arr.find((x) => x.id === id).name;

// Good
const hit = arr.find((x) => x.id === id);
if (!hit) throw new Error('not found');
return hit.name;
```

After applying fixes, re-run `zerou audit` and confirm zero findings remain.
