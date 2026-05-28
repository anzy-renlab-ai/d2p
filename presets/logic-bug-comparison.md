---
id: logic-bug-comparison
version: 2
name: Logic bugs — comparison / equality / boolean confusion
appliesTo: []
rules:
  - ruleId: loose-equality-not-null
    label: "Loose `==` / `!=` (not the canonical `== null` idiom)"
    severity: P2
    mechanism: static-grep
    source: logic-bug-comparison/v2
    rationale: "`x == y` coerces both sides; `[] == false` is true, `0 == ''` is true, `'1' == 1` is true. Many BugsJS data-processing fixes replace `==` with `===` (and the `!=` mirror). `== null` / `!= null` are the only sanctioned loose forms (intentional null-or-undefined check)."
    detection:
      pattern: "[^=!<>]([!=])==?\\s+(?!null\\b)(?!undefined\\b)[a-zA-Z0-9_$'\"`\\[\\{(]"
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: replace == with === and != with !==. The only exception is `x == null` (matches both null and undefined intentionally).'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: typeof-wrong-string
    label: "typeof compared to non-canonical string (e.g. 'array' / 'null' / 'date')"
    severity: P1
    mechanism: static-grep
    source: logic-bug-comparison/v2
    rationale: "`typeof x === 'array'` is always false — typeof returns 'object' for arrays. Same for 'null', 'date', 'regexp', 'NaN'. These comparisons silently mark every input as the wrong type. Common in BugsJS 'missing type check' bugs (eslint Bug-3, Bug-4)."
    detection:
      pattern: typeof\s+[a-zA-Z_$][a-zA-Z0-9_$.()\[\]]*\s*[!=]==?\s*['"`](array|null|undefined\s|date|regexp|nan|nullish)['"`]
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: typeof can only return: undefined, boolean, number, string, bigint, symbol, function, object. For arrays use Array.isArray(x); for null use x === null.'"
      verifyCommand: "! grep -rE 'typeof\\s+[a-zA-Z_$][a-zA-Z0-9_$.()\\[\\]]*\\s*[!=]==?\\s*[\\\"'\\''`](array|null|undefined |date|regexp|nan|nullish)[\\\"'\\''`]' ."
  - ruleId: nan-equality-check
    label: "Equality / inequality comparison against NaN"
    severity: P2
    mechanism: static-grep
    source: logic-bug-comparison/v2
    rationale: "`x === NaN` and `x == NaN` are always false (NaN is never equal to anything, including itself). `x !== NaN` is always true. Use `Number.isNaN(x)` or `x !== x` (self-inequality is the canonical NaN test). BugsJS data-validation bugs frequently include a fixed NaN check."
    detection:
      pattern: "[!=]==?\\s*NaN\\b|\\bNaN\\s*[!=]==?"
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: replace `x === NaN` with `Number.isNaN(x)`. Comparisons to NaN are always false.'"
      verifyCommand: "! grep -rE '[!=]==?\\s*NaN\\b|\\bNaN\\s*[!=]==?' ."
  - ruleId: array-includes-on-string-or-truthy
    label: "`~arr.indexOf(x)` bitwise trick used for membership test"
    severity: P3
    mechanism: static-grep
    source: logic-bug-comparison/v2
    rationale: "`~arr.indexOf(x)` returns 0 (falsy!) when the element is at index -1, but Number.isFinite issues aside, the modern `arr.includes(x)` is clearer and avoids accidental sign confusion when refactored. Hexo's old `!~routeList.indexOf(path)` shows up in BugsJS-era code."
    detection:
      pattern: "~[a-zA-Z_$][a-zA-Z0-9_$.()\\[\\]]*\\.indexOf\\s*\\("
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: replace `~arr.indexOf(x)` with `arr.includes(x)` and `!~arr.indexOf(x)` with `!arr.includes(x)`.'"
      verifyCommand: "! grep -rE '~[a-zA-Z_$][a-zA-Z0-9_$.()\\[\\]]*\\.indexOf\\s*\\(' ."
  - ruleId: string-equality-where-number-expected
    label: "String literal compared with `===` to a `.length` / `.size` / index"
    severity: P2
    mechanism: static-grep
    source: logic-bug-comparison/v2
    rationale: "`arr.length === '0'` or `idx === '0'` is always false — `length`/index are numbers. Common subtle bug when query-string parsed values flow into a numeric comparison."
    detection:
      pattern: \.(length|size)\s*[!=]==?\s*['"`]\d+['"`]
      filePattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}"
    fix:
      kind: template
      command: "echo 'manual remediation: drop the quotes — compare to a number literal (arr.length === 0). Or coerce the other side: Number(query.x) === arr.length.'"
      verifyCommand: "! grep -rE '\\.(length|size)\\s*[!=]==?\\s*[\\\"'\\''`]\\d+[\\\"'\\''`]' ."
---

# Logic bugs — comparison / equality / boolean confusion

Five patterns for the BugsJS-flavour "comparison silently false / true"
bug class. ESLint Bug-3 and Bug-4 (missing type check) and Express
Bug-8 (`arg.length !== 0` confusion) are the canonical examples.

1. **`loose-equality-not-null`** — `==` / `!=` outside the `== null`
   idiom; coerces both sides and matches the wrong things.
2. **`typeof-wrong-string`** — `typeof x === 'array'` is always false;
   typeof never returns 'array', 'null', 'date', 'regexp', 'NaN'.
3. **`nan-equality-check`** — `x === NaN` is always false; use
   `Number.isNaN(x)`.
4. **`array-includes-on-string-or-truthy`** — `~arr.indexOf(x)` legacy
   trick; modernise to `arr.includes(x)`.
5. **`string-equality-where-number-expected`** — `arr.length === '0'`
   compares a number to a string and is always false.

## Remediation patterns

```js
// Bad — typeof never returns 'array'
if (typeof xs === 'array') process(xs);

// Good
if (Array.isArray(xs)) process(xs);
```

```js
// Bad — always false
if (n === NaN) return defaultN;

// Good
if (Number.isNaN(n)) return defaultN;
```

After applying fixes, re-run `zerou audit` and confirm zero findings remain.
