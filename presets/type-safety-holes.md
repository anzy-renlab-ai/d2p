---
id: type-safety-holes
version: 2
name: Type safety holes (vibe-coded TS apps)
appliesTo: []
rules:
  - ruleId: ts-ignore-no-comment
    label: "// @ts-ignore without rationale comment"
    severity: P2
    mechanism: static-grep
    source: type-safety-holes/v2
    rationale: "`// @ts-ignore` silently disables the type checker for the next line. Without a `-- why` explanation reviewers cannot tell whether this is a legitimate workaround (vendored type bug, intentional unsafe cast) or a band-aid hiding a real bug. Require a rationale on the same line."
    detection:
      pattern: //\s*@ts-ignore\s*$
      filePattern: src/**/*.{ts,tsx}
    fix:
      kind: template
      command: "echo 'manual remediation: add rationale — // @ts-ignore -- upstream types wrong (see @types/x#123). Better: replace with @ts-expect-error so it flags when the underlying issue is fixed.'"
      verifyCommand: "! grep -rE '//\\s*@ts-ignore\\s*$' src/"
  - ruleId: ts-expect-error-no-comment
    label: "// @ts-expect-error without rationale comment"
    severity: P2
    mechanism: static-grep
    source: type-safety-holes/v2
    rationale: "`// @ts-expect-error` is preferred over @ts-ignore because it errors when the underlying type issue is fixed — but only if reviewers can tell why it was needed. Require a rationale on the same line."
    detection:
      pattern: //\s*@ts-expect-error\s*$
      filePattern: src/**/*.{ts,tsx}
    fix:
      kind: template
      command: "echo 'manual remediation: add rationale — // @ts-expect-error -- waiting on PR upstream/lib#456'"
      verifyCommand: "! grep -rE '//\\s*@ts-expect-error\\s*$' src/"
  - ruleId: any-cast-as-any
    label: "Value cast to `any` (loses all type information)"
    severity: P3
    mechanism: static-grep
    source: type-safety-holes/v2
    rationale: "`x as any` disables type-checking from this point onward in the expression. Downstream code operates on an unchecked value; common bug source. Prefer `unknown` + a validator, or narrow to a specific type."
    detection:
      pattern: \bas\s+any\b
      filePattern: src/**/*.{ts,tsx}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: replace `x as any` with `x as unknown as TargetType` only after validation, or use zod / valibot to parse-and-narrow'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: unknown-not-validated
    label: "External `unknown` value accessed without validation"
    severity: P2
    mechanism: llm-judgment
    source: type-safety-holes/v2
    rationale: "Receiving `unknown` from `JSON.parse`, `fetch().json()`, `req.body`, or a message bus and then reaching for `.property` without first checking the shape is a runtime crash waiting to happen. Use zod / valibot / yup, or hand-rolled type guards."
    detection:
      pattern: (JSON\.parse\s*\(|await\s+[a-zA-Z_$][a-zA-Z0-9_$.]*\.json\s*\(|req\.body)
      filePattern: src/**/*.{ts,tsx}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: parse with zod (Schema.parse(value)) or write a hand-rolled isFoo(x): x is Foo type guard before accessing fields'"
      verifyCommand: "echo 'manual review required'"
  - ruleId: zod-missing-on-body
    label: "Request handler reads req.body without a validator"
    severity: P2
    mechanism: llm-judgment
    source: type-safety-holes/v2
    rationale: "Express / Fastify / Hono handlers typing `req.body` as `any` skip every validation. Attackers can send arbitrary shapes (extra fields for mass-assignment, wrong types to crash the handler, oversized payloads). Parse with zod / valibot / class-validator before reaching business logic."
    detection:
      pattern: req\.body\.
      filePattern: src/**/*.{ts,tsx}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: define const Body = z.object({...}); const parsed = Body.parse(req.body); use parsed.x instead of req.body.x'"
      verifyCommand: "grep -rE '(z\\.object|valibot|class-validator|@hapi/joi|yup\\.object)' src/"
  - ruleId: non-null-assertion-on-input
    label: "Non-null assertion (!) used on req.body / req.query / req.params"
    severity: P2
    mechanism: static-grep
    source: type-safety-holes/v2
    rationale: "`req.body.user!.id` tells TypeScript the field is non-null without checking at runtime. Real requests with missing fields throw `Cannot read properties of undefined`. Validate the input shape with zod / valibot or write defensive `if (!x) throw` checks instead."
    detection:
      pattern: req\.(body|query|params|headers)(\.[a-zA-Z_$][a-zA-Z0-9_$]*)*!
      filePattern: src/**/*.{ts,tsx}
    fix:
      kind: template
      command: "echo 'manual remediation: replace `req.body.x!.y` with a zod schema (Body.parse) or an explicit if-guard; never assert non-null on user input'"
      verifyCommand: "! grep -rE 'req\\.(body|query|params|headers)(\\.[a-zA-Z_$][a-zA-Z0-9_$]*)*!' src/"
---

# Type safety holes

Six TS escape hatches that downgrade a typed codebase to an `any`-soup.
Each one silently turns a compile error into a production crash.

1. **`ts-ignore-no-comment`** / **`ts-expect-error-no-comment`** —
   directives without a rationale. Future readers cannot decide whether to
   remove or preserve.
2. **`any-cast-as-any`** — `x as any` discards every guarantee. Prefer
   `unknown` + a validator.
3. **`unknown-not-validated`** — JSON.parse / fetch().json() / req.body
   accessed as if it had a known shape. Use zod / valibot.
4. **`zod-missing-on-body`** — Express / Fastify handlers without a body
   schema. Mass-assignment risk + runtime crashes.
5. **`non-null-assertion-on-input`** — `req.body.x!.y` lies about
   runtime nullability.

## Remediation patterns

```ts
// Validate at the boundary
import { z } from 'zod';
const Body = z.object({ name: z.string().min(1).max(80), age: z.number().int() });
app.post('/users', (req, res) => {
  const parsed = Body.parse(req.body);   // throws on bad input
  // ... parsed is fully typed and safe
});
```

```ts
// Explain ts-expect-error
// @ts-expect-error -- upstream lodash@4 types missing _.zipObjectDeep return narrowing; PR #5512
const result = _.zipObjectDeep(keys, values);
```

```ts
// Replace `as any` with validation
const raw: unknown = JSON.parse(text);
const Parsed = z.object({ ok: z.boolean() });
const data = Parsed.parse(raw);
```

After applying fixes, re-run `zerou audit` and confirm zero findings remain.
