---
id: logic-bug-arithmetic
version: 2
name: Logic bugs — arithmetic / index / numeric coercion
appliesTo: []
rules:
  - ruleId: off-by-one-le-length
    label: "Loop bound `<=` against `.length` (off-by-one)"
    severity: P2
    mechanism: static-grep
    source: logic-bug-arithmetic/v2
    rationale: "`for (var i = 0; i <= arr.length; i++)` runs one iteration past the end; `arr[arr.length]` is undefined. The canonical loop uses `<`. Classic off-by-one captured in many BugsJS data-processing fixes (express router Bug-1, eslint indent Bug-2/Bug-5)."
    detection:
      pattern: for\s*\([^)]*;\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*<=\s*[a-zA-Z_$][a-zA-Z0-9_$.]*\.length\b
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: change `i <= arr.length` to `i < arr.length`. The last valid index is arr.length-1.'"
      verifyCommand: "! grep -rE 'for\\s*\\([^)]*;\\s*[a-zA-Z_$][a-zA-Z0-9_$]*\\s*<=\\s*[a-zA-Z_$][a-zA-Z0-9_$.]*\\.length\\b' ."
  - ruleId: array-index-equals-length
    label: "`arr[arr.length]` access (always undefined)"
    severity: P2
    mechanism: static-grep
    source: logic-bug-arithmetic/v2
    rationale: "`arr[arr.length]` returns undefined; the last element is `arr[arr.length - 1]`. Common BugsJS bug shape where a fix replaces a stray `.length` index with `.length - 1` (mongoose documentarray Bug-5)."
    detection:
      pattern: ([a-zA-Z_$][a-zA-Z0-9_$]*)\[\1\.length\]
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: replace `arr[arr.length]` with `arr[arr.length - 1]` (or the canonical `arr.at(-1)` in modern JS).'"
      verifyCommand: "! grep -rE '([a-zA-Z_$][a-zA-Z0-9_$]*)\\[\\1\\.length\\]' ."
  - ruleId: parseint-no-radix
    label: "parseInt() called without explicit radix"
    severity: P3
    mechanism: static-grep
    source: logic-bug-arithmetic/v2
    rationale: "`parseInt('010')` historically returned 8 (octal). Modern engines mostly default to 10 but explicit radix prevents legacy footguns and silences linters. Express request Bug-4 introduced explicit radix in a fix; ESLint comma-dangle Bug-7 sits in a similar parsing context."
    detection:
      pattern: \bparseInt\s*\(\s*[^,)]+\)
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: parseInt(x, 10) — always pass the radix as the second argument.'"
      verifyCommand: "! grep -rE '\\bparseInt\\s*\\(\\s*[^,)]+\\)' ."
  - ruleId: getmonth-zero-indexed-confusion
    label: "Date `.getMonth()` used arithmetically without +1"
    severity: P2
    mechanism: static-grep
    source: logic-bug-arithmetic/v2
    rationale: "`Date.prototype.getMonth()` is 0-indexed (Jan = 0). Code shaped `getMonth() + '/'` or `getMonth() === 12` produces off-by-one calendar bugs. BugsJS month/year processing bugs cluster around date helpers."
    detection:
      pattern: \.getMonth\s*\(\s*\)\s*([+\-*/%]|[=!<>]==?|\.)
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: add + 1 — month is zero-indexed (Jan=0..Dec=11). Or use Intl.DateTimeFormat for locale-aware month names.'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: substring-vs-slice-negative
    label: "`.substring(...)` called with arithmetic that may go negative"
    severity: P3
    mechanism: static-grep
    source: logic-bug-arithmetic/v2
    rationale: "`String.prototype.substring(a, b)` *swaps* arguments if a > b and treats negatives as 0 — silently masking off-by-one errors. `String.prototype.slice` does the intuitive thing. Hexo box Bug-10 (`base.substring(base.length - 1)`) and karma reporter Bug-8 illustrate the family."
    detection:
      pattern: \.substring\s*\(\s*[a-zA-Z_$][a-zA-Z0-9_$.]*\s*[-+]
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: when args can be negative or out of order, switch to .slice() which clamps end and respects sign as intended.'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: unary-plus-untrusted
    label: "Unary `+` coercion on options / args / params"
    severity: P3
    mechanism: static-grep
    source: logic-bug-arithmetic/v2
    rationale: "`+options.x` returns NaN for non-numeric input; downstream arithmetic silently produces NaN that propagates. BugsJS bugs in hexo paginator Bug-9 use this exact pattern (`+options.end_size`). Validate with Number.isFinite or zod before coercion."
    detection:
      pattern: \+(options|opts|args|params|input|cfg|settings|config)\.[a-zA-Z_$]
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: const n = Number(options.x); if (!Number.isFinite(n)) throw new TypeError(\"x must be a number\"); — never let NaN propagate.'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: length-minus-one-no-guard
    label: "`x[x.length - 1]` without prior empty-check"
    severity: P3
    mechanism: static-grep
    source: logic-bug-arithmetic/v2
    rationale: "`arr[arr.length - 1]` is `arr[-1]` when arr is empty → undefined. Downstream property access then throws. BugsJS fixes frequently add an explicit `.length > 0` guard before last-element access. Hexo `is.js` (`path[path.length - 1]`) is the canonical case."
    detection:
      pattern: ([a-zA-Z_$][a-zA-Z0-9_$]*)\[\1\.length\s*-\s*1\]
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: guard with `if (arr.length > 0)` before arr[arr.length - 1], or use `arr.at(-1)` and check for undefined.'"
      verifyCommand: "echo 'manual review required'"
---

# Logic bugs — arithmetic / index / numeric coercion

Seven patterns capture the BugsJS numeric / boundary bug family.

1. **`off-by-one-le-length`** — `for (… i <= arr.length …)` runs one
   past the end; canonical off-by-one.
2. **`array-index-equals-length`** — `arr[arr.length]` is undefined;
   should be `arr.length - 1`.
3. **`parseint-no-radix`** — `parseInt(x)` without radix; legacy
   octal footgun.
4. **`getmonth-zero-indexed-confusion`** — `.getMonth()` is 0-indexed;
   arithmetic without `+1` mislabels months.
5. **`substring-vs-slice-negative`** — `.substring()` swaps args and
   treats negatives as 0; use `.slice()`.
6. **`unary-plus-untrusted`** — `+options.x` returns NaN for
   non-numeric input; validate with `Number.isFinite`.
7. **`length-minus-one-no-guard`** — `arr[arr.length - 1]` on a
   possibly-empty array; guard or use `.at(-1)`.

## Remediation patterns

```js
// Bad — off-by-one
for (let i = 0; i <= arr.length; i++) console.log(arr[i]);

// Good
for (let i = 0; i < arr.length; i++) console.log(arr[i]);
```

```js
// Bad — NaN propagates
const size = +options.size;
const total = size * 10;

// Good
const size = Number(options.size);
if (!Number.isFinite(size)) throw new TypeError('size must be a number');
const total = size * 10;
```

After applying fixes, re-run `zerou audit` and confirm zero findings remain.
