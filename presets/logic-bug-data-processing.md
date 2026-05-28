---
id: logic-bug-data-processing
version: 2
name: Logic bugs — data processing / mutation / coercion edges
appliesTo: []
rules:
  - ruleId: param-reassign-then-use
    label: "Function parameter reassigned with `||` default then used as-is"
    severity: P2
    mechanism: static-grep
    source: logic-bug-data-processing/v2
    rationale: "`function f(options) { options = options || {}; ...}` is fine, but `function f(arr) { arr = arr || []; arr.push(x); }` silently mutates the *caller's* array when one was passed. BugsJS includes mutation-of-parameter fixes (mongoose schema/array Bug-6 and friends)."
    detection:
      pattern: ^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\1\s*\|\|\s*[\[\{]
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: llm-only
      command: "echo 'manual remediation: if the default is a fresh object/array, use a new local — `const local = arr ?? []` — to avoid mutating the caller. Default parameter syntax (`function f(arr = [])`) creates a new default each call.'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: regex-no-anchor-on-validation
    label: "RegExp.test without ^ / $ anchors on validation input"
    severity: P2
    mechanism: static-grep
    source: logic-bug-data-processing/v2
    rationale: "`/foo/.test(x)` matches `'foobar'` and `'xfoox'`. When the regex is meant to validate the whole input, anchors are required. Karma Bug-1 (reporter regex), ESLint arrow-spacing Bug-6 illustrate the family."
    detection:
      pattern: /(?![\^])[^/\n]{1,40}(?<![$])/\s*\.\s*test\s*\(
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: anchor the regex — /^foo$/.test(x) — when validating; or use String#includes / startsWith / endsWith for clearer intent.'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: string-concat-where-template-cleaner
    label: "String concatenation with arithmetic mixing number and string"
    severity: P3
    mechanism: static-grep
    source: logic-bug-data-processing/v2
    rationale: "`'count: ' + n + 1` parses as `'count: ' + n + 1` → `'count: 31'` instead of `'count: 4'` when n=3. Group with parentheses or use a template literal. BugsJS data-processing fixes include several string-concat off-by-one fixups."
    detection:
      pattern: ['"`][^'"`]*['"`]\s*\+\s*[a-zA-Z_$][a-zA-Z0-9_$.()\[\]]*\s*\+\s*\d
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: wrap arithmetic: `count: ` + (n + 1) — or use a template literal: `count: ${n + 1}`.'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: array-push-return-misuse
    label: "Value of `.push()` used as if it were the pushed element"
    severity: P2
    mechanism: static-grep
    source: logic-bug-data-processing/v2
    rationale: "`Array.prototype.push` returns the new length, not the appended element. Code like `const item = arr.push(x); item.name` silently fails. Common micro-bug captured in BugsJS data-processing fixes."
    detection:
      pattern: (var|let|const)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*[a-zA-Z_$][a-zA-Z0-9_$.]*\.push\s*\(
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: push() returns the new length. To keep the appended item, assign it before the push: const item = x; arr.push(item).'"
      verifyCommand: "! grep -rE '(var|let|const)\\s+[a-zA-Z_$][a-zA-Z0-9_$]*\\s*=\\s*[a-zA-Z_$][a-zA-Z0-9_$.]*\\.push\\s*\\(' ."
  - ruleId: split-without-limit
    label: "String#split with no limit on potentially user-controlled input"
    severity: P3
    mechanism: static-grep
    source: logic-bug-data-processing/v2
    rationale: "`req.headers['x-fwd'].split(',')[0]` works, but `.split(/\\s*,\\s*/)` etc on a header with unbounded entries can produce surprisingly large arrays. Express request Bug-2 (line 361, `proto.split(/\\s*,\\s*/)[0]`) is exactly this shape — fix in upstream added trust-proxy guards around the split."
    detection:
      pattern: \.split\s*\(\s*(/[^/]+/|['"`][^'"`]+['"`])\s*\)\s*\[\s*0\s*\]
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: when only the first item is needed, pass a limit — split(sep, 1) — or use indexOf+slice. Validate trust-proxy state before extracting.'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: replace-only-first
    label: "String#replace with string (not RegExp) replaces only first occurrence"
    severity: P2
    mechanism: static-grep
    source: logic-bug-data-processing/v2
    rationale: "`'a/b/c'.replace('/', '_')` returns `'a_b/c'`, not `'a_b_c'`. Use `.replaceAll(...)` or `replace(/\\//g, '_')`. BugsJS includes data-processing fixes where a string-replace silently skipped later occurrences."
    detection:
      pattern: \.replace\s*\(\s*['"`][^'"`]{1,40}['"`]\s*,
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: use replaceAll(sep, repl) or replace(/sep/g, repl) when you want every occurrence. String-arg replace only fires once.'"
      verifyCommand: "echo 'manual review required'"
---

# Logic bugs — data processing / mutation / coercion edges

Six patterns for the BugsJS "data silently mangled" bug class.
Strong overlap with Express, Mongoose, Karma, Hexo bugs labelled
"incorrect data processing" in the BugsJS taxonomy.

1. **`param-reassign-then-use`** — `arr = arr || []; arr.push(x)`
   mutates the caller's array when one was passed.
2. **`regex-no-anchor-on-validation`** — `/foo/.test(x)` allows
   substring matches; use anchors.
3. **`string-concat-where-template-cleaner`** — `'n: ' + n + 1` parses
   as left-to-right concatenation, producing `'n: 31'` not `'n: 4'`.
4. **`array-push-return-misuse`** — `.push()` returns the new length,
   not the appended element.
5. **`split-without-limit`** — `.split(sep)[0]` on untrusted input
   allocates the full array; pass a limit.
6. **`replace-only-first`** — `'a/b'.replace('/', '_')` replaces only
   the first occurrence; use `.replaceAll` or a global RegExp.

## Remediation patterns

```js
// Bad — replaces only first '/'
const safe = path.replace('/', '_');

// Good — every '/'
const safe = path.replaceAll('/', '_');
// or
const safe = path.replace(/\//g, '_');
```

```js
// Bad — pushes return value to wrong variable
const job = jobs.push(makeJob());
worker.process(job);              // job is a number

// Good
const job = makeJob();
jobs.push(job);
worker.process(job);
```

After applying fixes, re-run `zerou audit` and confirm zero findings remain.
