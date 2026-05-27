# Log Injection Critique — Phase 10 Module B

Reviewer: senior code-review specialist
Targets: `cli/src/enhance/log-planner.ts`, `cli/src/enhance/log-executor.ts`, `cli/src/enhance/types.ts`, `docs/plans/2026-05-27-phase-10-enhance.md`

## TL;DR

**Do not ship this in front of real users as a flagship "auto-improve my codebase" feature.** The regex approach is acceptable as an internal smoke for `phase5-demo`, but on any non-trivial JS/TS project (Next.js App Router, anything with shebangs, JSX, comments mentioning `console.log`, or pre-existing `import { logger } from '@elsewhere'`) it will silently corrupt files or produce code that does not compile. Idempotency is theoretical — the `next === r.content` guard at log-executor.ts:458 protects re-writes but does not protect cross-run consistency once the user touches a file. The blast radius is whole-file `fs.writeFileSync` with no dry-run, no diff preview, no transactional rollback. The plan promises "AST 改" (plan line 51, "B: log-executor … AST 改") but the implementation is pure `String.replace`. That's a spec/impl drift the user was told would not happen.

## Catastrophic bugs (P1 — fix before any user runs this)

- **Existing `logger` import from a different package shadows ours, leaving call sites referencing the wrong logger.** `hasLoggerImport` (log-executor.ts:151–153) matches *any* `import { logger } from '…'`. If the file already has `import { logger } from '@my-org/log'` or `import { logger } from 'pino-elsewhere'`, the executor skips our import injection (line 453), but its new `logger.error({ err: e }, 'unhandled')` calls now reference a foreign logger whose API may differ (e.g., winston's `logger.error(message, meta)` signature is `(string, object)`, not pino's `(object, string)`). Failing input: `import { logger } from '@my-org/log';\ntry { x() } catch (e) {}` → output compiles but emits structured payloads in a shape the foreign logger drops or throws on. **Severity: silent log loss + runtime exception in production.**

- **Regex rewrites inside string literals, template literals, and comments.** Both `transformSilentCatches` (log-executor.ts:177–195) and `transformConsoleCalls` (log-executor.ts:205–216) run unconditionally on whole-file text.
  - Failing input 1: `` const code = `try { foo() } catch (e) {}` `` — rewritten to inject a real `logger.error` call inside the template, breaking the string and likely producing a syntax error if the template was used as code-to-eval.
  - Failing input 2: `// console.log is deprecated, use logger.info` — rewritten to `// logger.info is deprecated, use logger.info` (mangles documentation but compiles).
  - Failing input 3: `<Code value="console.log('x')" />` — rewritten to `<Code value="logger.info('x')" />` (changes user-visible UI string).
  - Failing input 4: `const banner = "type console.log(…) to print";` — same. **Severity: silent data corruption of literals; rendered UI changes; eval-ed code breaks.**

- **Shebang line is destroyed by import injection.** `insertImport` (log-executor.ts:155–164) checks only for `^(?:import\s…)+` at offset 0. If line 1 is `#!/usr/bin/env node`, no leading import block exists, so the import is prepended **before** the shebang (line 163: `return importLine + content`). Node refuses to execute the file (shebang must be byte 0). Failing input: any CLI entry file (`bin/foo.ts`, `cli.mjs`) with `console.log('hi')`. **Severity: CLI bins no longer runnable.**

- **`'use client'` / `'use server'` directives broken.** Same root cause. Next.js requires the directive to be the **first** statement before any imports. `insertImport` prepends an import unconditionally when no top-of-file import block exists, pushing `'use client'` below the import and silently downgrading the file from a Client Component to a Server Component. Failing input: any `app/**/*.tsx` that starts with `'use client';\n\nimport …`. **Severity: Next.js build still passes but runtime behavior changes — hooks throw, events stop firing.** This is the worst class of bug: invisible in CI, fatal in browser.

- **BOM-prefixed files break import injection.** A leading `﻿` makes `^import…` not match at index 0 (the regex sees `﻿import`), so the import is prepended *before* the BOM, producing an invalid UTF-8 sequence in the middle of the file. Failing input: any file authored on Windows with VS Code's default UTF-8-with-BOM. **Severity: TS compiler errors with "Invalid character".**

- **`catch (e) { return null ?? fallback(); }` is silently mangled.** The silent-catch regex at log-executor.ts:179 matches the prefix `catch (e) {…return null` because the body alternation `return\s+(?:null|undefined|void\s+0)\s*;?\s*\}` requires a closing `}` to follow `null`. So in the `?? fallback()` case the **outer** regex won't match at all — *that* is fine. But `catch (e) { return null; foo(); }` *also* won't match because `}` doesn't immediately follow `null;`. The planner, however, uses the *looser* `SILENT_CATCH_RE` at log-planner.ts:249 which has the same shape, so the site is correctly **not** flagged. Good. But: `catch (e) { return null }` (no semicolon, no extra statement) **is** matched and rewritten — and the rewriter's body parsing at log-executor.ts:191 (`body.replace(/^\}$/, '').replace(/^\{?\s*/, '').replace(/\s*\}$/, '').trim()`) is brittle: it assumes `body` always ends in `}`. The regex `body` capture is literally `\}|return…\}`, so `body` is either `}` or `return null;}`. The three chained `replace`s produce `return null;` — OK. But this only works because of *exact* regex shape. Any future tweak to the regex (e.g., adding `return false`) without updating the three-replace chain will produce malformed output. **Severity: footgun, latent.**

- **Re-entrant rewrite once user adds a non-trivial catch body.** Idempotency depends on `transformSilentCatches` not re-matching its own output. After rewrite the body becomes `{ logger.error({ err: e }, 'unhandled'); }`, which does **not** match `\{\s*(?:\}|return…)`, so the regex won't re-fire. Good. But the planner (log-planner.ts:250) **also** uses a regex that only matches `{}` or `{return null}`, so on second run the site is not even flagged — `kinds` set won't contain `silent-catch`, `transformSilentCatches` won't be invoked, and the file is left alone. That part is fine. **However** — if the user has the file open and edits the rewritten body to anything else, on next run the planner will *still* skip it but the import remains imported, looking orphaned. Worse: on a *fresh* worktree (which is the documented workflow at plan line 14), the second run starts from a clean `main` checkout, so all rewrites are re-applied. The user can't "incrementally enhance" — each run is total.

## Serious bugs (P2 — fix before promoting as flagship feature)

- **`class Foo { console = …; bar() { this.console.log(x) } }` is mangled.** `CONSOLE_LOG_RE` at log-executor.ts:208 is `console\s*\.\s*(log|info|…)\s*\(`. It matches `this.console.log(x)` because there's no preceding-word boundary check. Output: `this.logger.info(x)`. The user's class no longer references its own `console` member. Failing input: any file with a property literally named `console`.

- **`pino-pretty` is unconditionally added to devDependencies even when the user explicitly uses `existing-pino`.** Wait — actually at log-executor.ts:331 it's gated on `deps.includes('pino')`, and `installDepsFor('existing-pino')` returns `[]` (log-planner.ts:121–123), so `existing-pino` users are not forced. But for fresh installs the bootstrap template at log-executor.ts:53–56 hard-codes `transport: { target: 'pino-pretty' }`. If the project later switches `NODE_ENV` evaluation logic or builds the bootstrap with bundlers that don't tree-shake the dev branch, `pino-pretty` may be required at production runtime — Pino throws "unable to determine transport target" on missing transport package. The plan never asked for pino-pretty (line 79: `installDeps` says `['pino', 'pino-http']`).

- **Middleware template imports a hard-coded path: `import { logger } from './src/logger'` (log-executor.ts:66).** This is wrong in two ways:
  1. `middleware.ts` at project root → relative path `./src/logger` is correct.
  2. `src/middleware.ts` → relative path should be `./logger`, not `./src/logger`. The planner at log-planner.ts:165 happily picks `src/middleware.ts` as a candidate, then the executor writes the wrong import path. **TypeScript build fails.**

- **Next.js App Router edge runtime incompatibility.** The middleware template imports `pino` transitively (via `./src/logger`). Pino's worker-transport mode uses `worker_threads`, which is **not available** in Next.js Edge runtime. If the user has `export const runtime = 'edge'` in their root config or in the middleware, `next build` fails or runtime crashes. The template should detect this or, at minimum, use the synchronous Pino constructor without `transport`. The plan (lines 56–57) brags about middleware as a Next.js feature but the template assumes Node runtime.

- **`MAX_SITES = 200` silently truncates.** log-planner.ts:44. On a real codebase (e.g., `agent-game-platform` mentioned in the plan's verify section) you'll hit 200 quickly across `console.log` + `catch` + `db-call` + `external-fetch`. Site 201+ is dropped with a single `cap-reached` log; the user has no idea which sites were not enhanced. Worse: ordering is non-deterministic — files are walked by directory order; whichever ones are walked last get truncated. No "top-N by severity" prioritization.

- **`existing-winston` / `existing-bunyan` users get `logger.error({ err: e }, 'unhandled')` (a Pino-shaped call).** Both `transformSilentCatches` (log-executor.ts:187, 192) and `transformConsoleCalls` (line 212) emit Pino-style calls regardless of `plan.loggerLib`. Winston's API is `logger.error(message, meta)` and Bunyan's is `logger.error({err}, message)` (closer to Pino but not identical for older versions). The `loggerLib` field is read by the planner and threaded into the plan but **the executor never branches on it**.

- **Re-export-only files trigger import injection unnecessarily.** A file containing only `export * from './x'` will not have any sites detected (no `console.log`, no `catch`, no `app.get`), so `groupSites` returns empty for that file, so `applyToFile` is not called. **OK** — but the planner walks them and reads them into memory anyway (log-planner.ts:233). Performance, not correctness.

- **`existing-pino`/`existing-winston`/`existing-bunyan` users still get a brand new `src/logger.ts` written.** log-executor.ts:527 only checks `plan.bootstrapFile` (which the planner sets to `null` when an existing bootstrap is detected at log-planner.ts:501). **OK** when detection works. Detection only checks a fixed list of paths (log-planner.ts:135–144); a user with `app/utils/logging.ts` gets a duplicate `src/logger.ts` and the executor's `logger` import points at the new file, ignoring the user's existing pino setup.

## Minor / cosmetic (P3)

- **`destructured catch` ignored.** `catch ({ code, message }) {}` is not matched by either regex (the binding capture is `[A-Za-z_$][\w$]*`). This is probably fine for v1, but it means common Node.js `try/catch` patterns around `fs.promises` errors are not enhanced.
- **CRLF tolerance.** The regexes use `\s` which matches `\r\n`, so basic CRLF works. However the rewritten output uses `\n` exclusively (`importLine` ends in `\n` at line 148), introducing mixed line endings into pure-CRLF files. Cosmetic but annoys git/prettier.
- **`pino-pretty` injection check is one-shot, not idempotent.** log-executor.ts:331 — if a user removed `pino-pretty` deliberately, every `zerou enhance` re-adds it. No way to opt out.
- **`@ts-ignore` directive on line 1.** If a file is `// @ts-ignore\nimport x from 'broken';\nconsole.log(x)`, import injection runs `^(?:import…)+` which only matches starting at offset 0, but offset 0 is `// @ts-ignore`, not `import`. So the import is prepended before the `@ts-ignore`, leaving the directive dangling above an unrelated line (our new `import`), and below it the original `import x from 'broken'` is now un-ignored. Failing input.
- **Empty file or comment-only file.** `applyToFile` (log-executor.ts:393–491) — if `kinds` is empty, the function is never called (groupSites filters). If `kinds` is non-empty but the regex finds zero matches, `touched === 0` triggers the skip at line 442. Behaves correctly. **OK.**
- **No dry-run mode.** The plan example at line 14 shows `git diff main..HEAD` after the run as the review surface. Fine for a worktree workflow, but no `--dry-run` flag to print intended changes without writing. For an "improvement tool" this is a glaring omission.
- **Pinned versions sourced from where?** log-executor.ts:42–47. `pino@^9.5.0` is current as of late 2024; `pino-http@^10.3.0` is current; `winston@^3.15.0` is current; `bunyan@^1.8.15` matches latest 1.x. No URL/comment cites how these were picked or when they should be refreshed. Six months from now these are stale.

## Architectural concerns (not bugs but should be reconsidered)

- **Regex vs AST — the lost capabilities.** Going with `String.replace` loses, at minimum: comment/string awareness (P1 above), scope awareness (`this.console` vs global `console`, P2 above), correct insertion point for directives (P1 above), JSX-attribute awareness, and the ability to add `try/catch` around `await fetch(…)` (which is what the `external-fetch` and `db-call` site kinds *should* do but the executor explicitly skips, log-executor.ts:430–440 — "no-ops in v1"). The plan promises log injection at db/fetch/http boundaries; without an AST those are unimplementable, and the implementation candidly punts. **The flagship feature is half-done.**

- **Spec/impl drift.** Plan line 51: "B: log-executor    pino + pino-http + middleware + **AST 改**". Implementation: zero AST, all regex. This is a `phased_premature_stop` smell — the executor shipped silent-catch + console rewrite (the easy half) and gave up on the hard half (db/fetch/http rewriting) without flagging the gap. The `LogSiteKind` enum still includes `db-call`, `external-fetch`, `http-boundary`, `error-rethrow`, `unhandled-promise` (types.ts:21–28); the planner emits them; the executor silently no-ops them with a `logBranch(decision: 'skip')`. From the user's perspective `audit` says "found 47 sites" and `enhance` rewrites 12 — the other 35 vanish.

- **Blast radius.** Step 4 of `executeLogInjection` (log-executor.ts:557–570) iterates `grouped` files and writes each with `fs.writeFileSync`. If file 17 of 60 throws (e.g., EACCES), files 1–16 are already written and files 18–60 are unwritten. The worktree is in a half-applied state. There's no transactional commit ("write all to temp dir, then atomically rename"). The catch at line 566 just appends to `failures` and continues — fine for a worktree the user will throw away, but a power-user running on their main checkout (which they will, despite the plan's worktree workflow, because users always do) is in trouble.

- **Idempotency is content-equality, not semantic equivalence.** log-executor.ts:458 `if (next === r.content) … skip`. After a successful first run, the file no longer contains `console.log` so the second run's `transformConsoleCalls` produces zero changes, `next === r.content`, skip. Fine in steady state. But if the user manually fixes one of two `console.log`s in a file between runs, the second run rewrites the remaining one and re-injects the import (which is fine — `hasLoggerImport` catches the prior import). The third run is a no-op. Three-step convergence, not one-step. Not a bug; surprising.

- **No site-line use.** log-executor.ts:373–375 admits the planner's `line` data is discarded ("we don't actually need the site line numbers for transformation"). So the planner does 200 sites of work the executor ignores. The planner could be 10× simpler (just emit a set of file paths + kinds). Or — better — the executor could use line numbers to do *scoped* edits instead of whole-file regex, avoiding most of the P1 bugs.

- **No before/after diff stored anywhere.** Module H ("report") spec at plan line 64 mentions "每模块 diff stat + 验证结果" but the executor returns only `filesChanged: string[]` (types.ts:91). No actual diff content. The report writer will have to `git diff` against the worktree base, which works in the worktree workflow but means the executor has no in-memory record of what it changed — making post-hoc audit impossible without git.

## Recommended remediation path

### Option 1 — Minimal patches (~50 LOC, ship-blocker fixes only)

Build:
- `insertImport` detects and respects: BOM, shebang (line starts with `#!`), directive prologue (`'use client'`/`'use server'`/`'use strict'`), and leading comments. Insert *after* the last directive/leading-comment/shebang block.
- `hasLoggerImport` tightens to: `import { logger } from '<bootstrapRelPath>'` exactly (path-aware), not "any logger import". Otherwise insert.
- Pre-strip strings/comments/template literals from `content` before regex matching: build a redacted copy where those spans are replaced with `\0`-fill of equal length so offsets stay aligned, run regexes on the redacted copy, apply edits to the real copy at the matched offsets.
- Whitelist `console` only when preceded by start-of-line, `;`, `{`, `}`, `,`, `(`, `=>`, `=`, whitespace — i.e., not `.console`.
- Branch `transformSilentCatches` / `transformConsoleCalls` on `plan.loggerLib` to emit winston-shaped / bunyan-shaped calls when appropriate.
- Make middleware template's bootstrap import path computed from `bootstrapFile`, not hard-coded.
- Add `--dry-run` flag to the CLI surface.

**Still misses**: JSX-attribute strings (the redaction approach handles `value="console.log()"` because the value is a string literal), nested catches with complex bodies, the db/fetch/http-boundary rewriting (still unimplemented), Edge runtime mismatch, BOM round-tripping.

### Option 2 — ts-morph swap (~600 LOC, the right v2)

Replace `String.replace` with `ts-morph` (or `recast` + `@babel/parser` for JSX support). Build:
- Parse each file into a TypeScript AST, locate `CatchClause` nodes whose body is `EmptyBlock` or contains exactly one `ReturnStatement` returning `null`/`undefined`/`void 0`. Replace via AST surgery, print back with original formatting preserved.
- Locate `CallExpression` whose callee is `console.log`/`info`/`warn`/`error`/`debug` — `console` being a **global** `Identifier`, not a `PropertyAccessExpression` whose object is `this`/etc. Replace with `logger.<mapped>`.
- For middleware/bootstrap: parse target file, detect existing imports/directives, insert new statements via AST so directive prologue and shebang are automatically respected.
- For db-call / external-fetch / http-boundary: wrap the call in `await logger.info(…); try { … } catch (e) { logger.error(…); throw }` — this is what an AST buys you.
- Idempotency check: don't rely on regex non-matching; explicitly tag inserted nodes with a JSDoc `@zerou-inserted` and detect on re-parse.

**Still misses**: cross-file refactors (e.g., promoting an existing local `logger` const to import); runtime-aware decisions (Edge vs Node); semantic deduplication when the user already logs in a higher-up `try`.

### Option 3 — Full proper codemod (~1500 LOC, the eventual v3)

ts-morph + a project-level analysis pass:
- Build a symbol table; resolve `logger` references across files. Don't insert an import if the file already imports `logger` via *any* path; rename our `logger` to `zerouLogger` in those files instead.
- Detect framework runtime (Edge vs Node) by parsing `next.config.{js,mjs,ts}` and route-segment-level `export const runtime`. Branch the middleware template accordingly (Edge uses `console`-based Pino-less logger).
- Implement db-call / external-fetch / http-boundary by AST-wrapping calls inside the closest enclosing function/method; emit `correlationId` from the request-scoped `AsyncLocalStorage`.
- Atomic write: stage all changes in memory, write to a `.zerou-stage/` dir, then `fs.renameSync` per file at the end. Roll back stage on any failure.
- Emit a structured diff (per-file `before`/`after`) into the result object so Module H can render it without re-shelling to git.

**Still misses**: anything truly project-specific (custom error envelopes, OpenTelemetry integration, log-level routing). Those should be opt-in plug-ins.

---

**Recommendation**: do **not** ship the current implementation as `zerou enhance`'s flagship Module B. Land Option 1 immediately (the P1 fixes are ~50 LOC of regex hardening and unblock `phase5-demo` dogfood without lying to the user). Schedule Option 2 as the v2 deliverable before any public `zerou enhance` announcement.
