# Codemod Tooling Survey for ZeroU Log Injection

> Audience: ZeroU lead engineer deciding whether to keep regex-based whole-file
> rewrites (`cli/src/enhance/log-executor.ts` lines 175–230) or move to a proper
> AST-based codemod. Today we already use the TypeScript Compiler API
> *read-only* in `cli/src/agent/ast-analyzer.ts`. Mutating it is the next step.

## TL;DR — which to pick

**Keep regex for the current two transformations (silent-catch rewrite + `console.* → logger.*`), but add `ts-morph` as the *next* tool the moment we need a third, type-aware, or context-sensitive transform.** The two current rewrites are degenerate enough (line-local, no nested expressions, idempotent) that regex is honestly correct here; paying an 80 MB `node_modules` tax and a 2–5× per-file latency hit to "do it right" buys us almost nothing measurable. The day we want to *wrap* a function (e.g. inject `logger.child()` into every Next.js route handler, or instrument `await fetch(...)` with timing), regex breaks immediately and we want `ts-morph`. Do **not** pick `jscodeshift`; its `recast` printer is a known formatting-vandalism risk and Meta effectively stopped maintaining it for two years (now under community + Codemod-team rescue).

---

## The lineup

| Tool | First released | Maintainer (2026) | Lang | Output preservation | Type-aware | Dep size (npm install) | Recommend for ZeroU? |
|---|---|---|---|---|---|---|---|
| jscodeshift | 2015 (Meta) | Daniel15 + Codemod team (community rescue) | JS/TS | Poor (`recast` re-prints, drops quotes/JSDoc/parens) | No | ~100 MB (19 deps incl. babel + recast + ast-types) | No |
| ts-morph | 2018 (David Sherret) | David Sherret, very active | TS first | Good (delegates to `tsc`'s printer when surgical edit fails, but most edits are textual splices) | **Yes** (full `tsc` semantic info) | ~15 MB install, ~80 MB on disk after `tsc` payload | **Yes — recommended next step** |
| ast-grep | 2022 (Herrington Darkholme) | Active, now adopted by Codemod | Polyglot (JS/TS/Rust/Go/Py/HTML/CSS/...) | Excellent (CST-based, preserves whitespace + comments) | No (syntactic only) | ~50 MB Rust binary per platform via optionalDependencies | Yes — for non-type-aware bulk rewrites |
| Comby | 2019 (Rijnard van Tonder, Stripe alum) | Sourcegraph-backed, low activity | ~every language (string-template-ish) | Excellent (treats unchanged text verbatim) | Limited (Sourcegraph-side only) | Single OCaml binary, ~20 MB; not on npm | Tactical only — see §4 |
| swc/babel plugin | 2014 (babel) / 2017 (swc) | Babel team / Kdy1 | JS/TS | N/A — compile-time, source untouched | swc: no; babel-typescript: weak | swc-core ~30 MB / babel ~70 MB | Wrong tool — see §5 |
| TS Compiler API + `ts.transform` | 2015 (Microsoft) | Microsoft | TS | Mediocre (printer reformats unchanged subtrees) | **Yes** | 0 — we already ship `typescript` (~70 MB) | Plumbing, not a tool |
| GritQL | 2023 (Grit.io → Biome 2.0 plugin) | Grit Inc / Biome | Polyglot (tree-sitter) | Good | No (currently) | Rust binary; Biome plugin ships in Biome | Watch — not yet justified |

Sources for the table: [jscodeshift Issue #587 — maintenance announcement](https://github.com/facebook/jscodeshift/issues/587), [ts-morph npm](https://www.npmjs.com/package/ts-morph), [@ast-grep/cli-linux-x64-gnu install size](https://npmx.dev/package/@ast-grep/cli-linux-x64-gnu), [ast-grep/issue 1757 — binary size](https://github.com/ast-grep/ast-grep/issues/1757), [Comby docs](https://comby.dev/), [GritQL / Biome 2.0](https://github.com/biomejs/gritql).

---

## 1. jscodeshift

**Provenance.** Built at Meta in 2015 to migrate React internals (class → hooks, `React.createClass` → ES class, prop-types codemod, etc.) and used at "thousands of codemods at Meta" scale. It is still the de-facto baseline that every other tool gets compared to.

**API shape.** Imperative, fluent-collection-on-AST:

```js
// codemod: console.log(args) → logger.info(args)
export default function transformer(file, api) {
  const j = api.jscodeshift;
  return j(file.source)
    .find(j.CallExpression, {
      callee: {
        type: 'MemberExpression',
        object: { name: 'console' },
        property: { name: 'log' },
      },
    })
    .replaceWith(p => {
      const newCallee = j.memberExpression(
        j.identifier('logger'),
        j.identifier('info'),
      );
      return j.callExpression(newCallee, p.node.arguments);
    })
    .toSource();
}
```

**The good.** Battle-tested. Every major framework (React, Ember, Vue, AVA, MUI) ships codemods on it. Documentation is plentiful. Type-aware via `@babel/preset-typescript` (syntax level only, no type information).

**The bad — and it is bad.** The printer is [`recast`](https://github.com/benjamn/recast), which has been effectively unmaintained for years. [jscodeshift Issue #500 — "Bringing jscodeshift up to date"](https://github.com/facebook/jscodeshift/issues/500) calls out explicitly that "the biggest issue is with recast, which hasn't had much maintenance for the last couple of years and has something like 150+ issues and 40+ pull requests waiting to be merged. About 80% of the issues logged against jscodeshift are actually recast issues." Concrete vandalism modes that ZeroU users would feel:

- [recast #143](https://github.com/facebook/jscodeshift/issues/143) — newly inserted literals are always double-quoted even in a single-quote file
- [recast #258](https://github.com/facebook/jscodeshift/issues/258) — leading comments on parenthesised expressions get *moved inside the parentheses* when reprinted
- [recast #268](https://github.com/benjamn/recast/issues/268) — changing `const` ↔ `let` strips indentation from the entire `VariableDeclaration`
- [recast #370](https://github.com/benjamn/recast/issues/370) — adding a property to an object literal inserts surprise blank lines
- [recast #365](https://github.com/benjamn/recast/issues/365) — JSX whitespace gets mangled after any change
- [jscodeshift #67](https://github.com/facebook/jscodeshift/issues/67) — `.replaceWith` does not copy `.comments` from old node to new node, so JSDoc above a function disappears the moment you regenerate the function

**Maintenance status (verified 2026).** [Issue #587](https://github.com/facebook/jscodeshift/issues/587) confirms Daniel15 took over as official maintainer in 2021; in 2024 the Codemod team and ElonVolo were added. They have publicly committed to a TypeScript rewrite, but as of mid-2026 it has not shipped. The project is *not abandoned*, but is not the project Meta originally maintained either — and the underlying `recast` printer is what's broken.

**Dep footprint.** 19 direct dependencies (babel parser pack + recast + ast-types). Real-world `node_modules` cost is ~90–110 MB after de-dup. For a CLI tool we ship via npm, this is the heaviest of the bunch.

**Verdict for ZeroU.** No. If we are willing to pay ~100 MB and accept that our enhanced output may have its formatting subtly mangled in 1–2 % of files (looks petty, scares the user, makes diffs huge), why not just use the better tool with the same imperative power? See §2.

---

## 2. ts-morph

**Provenance.** Started 2018 as `ts-simple-ast` by David Sherret, renamed `ts-morph` in 2019, [installed by `ng-morph`, the Prisma generator, `ts-migrate` (Airbnb)](https://medium.com/airbnb-engineering/ts-migrate-a-tool-for-migrating-to-typescript-at-scale-cd23bfeb5cc), [Sourcegraph's `codemod`](https://github.com/sourcegraph/codemod), Nx internal generators, and almost every "AI codemod" startup that does TS (Codemod.com [explicitly added ts-morph support](https://codemod.com/blog/ts-morph-support) in 2024 alongside jscodeshift). It is essentially `tsc`'s `Program` + a friendly object model bolted on.

**API shape.** Object-oriented, type-aware:

```ts
import { Project, SyntaxKind } from 'ts-morph';

const project = new Project({ tsConfigFilePath: 'tsconfig.json' });

for (const sf of project.getSourceFiles('src/**/*.ts')) {
  // console.log(args) → logger.info(args)
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pae = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    if (pae.getExpression().getText() !== 'console') continue;
    const methodMap: Record<string, string> = {
      log: 'info', info: 'info', warn: 'warn', error: 'error', debug: 'debug',
    };
    const mapped = methodMap[pae.getName()];
    if (!mapped) continue;
    pae.getExpression().replaceWithText('logger');
    pae.getNameNode().replaceWithText(mapped);
  }
}
await project.save();
```

Critically, `replaceWithText` performs a **textual splice** of just the matched span — surrounding code, comments, and whitespace are not touched. This is the single biggest reason to pick ts-morph over jscodeshift: ts-morph never re-prints the whole file by default, so JSDoc above a function is untouched when you mutate the function body.

**Output preservation.** Excellent for narrow edits (textual splice). It degrades when you use *structure-level* mutators (`addStatements`, `insertParameter` etc.) because those go through `tsc`'s printer for the inserted slice — but even then only the *inserted* slice gets pretty-printed, not the rest of the file. There is no equivalent of recast's "I accidentally reformatted the whole VariableDeclaration."

**Type awareness.** This is the differentiator. With `getType()`, `getSymbol()`, `getReturnType()`, etc., you can write codemods like "wrap every function whose return type is `Promise<Response>`" — impossible in jscodeshift, ast-grep, or comby. For ZeroU's *current* two transforms this is not needed, but it is exactly the kind of thing we will reach for in Phase 11+ (e.g. "wrap every endpoint that returns `NextResponse` with a `withRequestId` middleware").

**Performance.** The official [performance page](https://ts-morph.com/manipulation/performance) admits "large files may take a bit of time" with no published numbers. Real-world data from `ts-migrate` (Airbnb) — which is a `ts-morph`-style approach using `tsc` directly + jscodeshift — showed 1,000-file conversions running in under 30 minutes including type inference. For ZeroU's case (no type checking needed for log injection, just AST walks), expect ~3–5× regex's speed: regex did 26 files in ~5 s, ts-morph ought to do the same in 10–20 s including project parse. The expensive step is the *first* `Project` instantiation (parsing tsconfig + all source files into one `Program`), so amortise it across the whole enhance run.

**Memory hygiene.** For long-lived loops you must call `.forget()` on transient nodes or you OOM on >1,000-file repos (see [ts-morph #192](https://github.com/dsherret/ts-morph/issues/192) for the gotcha that you can't `.forget()` after `.remove()`). Standard pattern: `sourceFile.forEachDescendant((node, traversal) => { ... }); sourceFile.saveSync();`.

**Dep footprint.** 1.5 MB install size, ~15 MB on disk *not counting `typescript`*. Since we already depend on `typescript` for `ast-analyzer.ts`, the marginal cost is ~15 MB, not 80 MB. This changes the calculus completely vs jscodeshift.

**Verdict for ZeroU.** Yes, **this is the answer for transformation #3 onward**. For #1 and #2 we don't need it; for the type-aware "wrap async endpoint" transforms we know are coming, it is the only sane choice.

---

## 3. ast-grep

**Provenance.** Started 2022 by Herrington Darkholme, written in Rust on top of tree-sitter. By mid-2026 it has been absorbed into the Codemod.com platform (alongside their `jssg` JavaScript runtime that authors transforms in TS but executes them against ast-grep's matcher). Active development; v0.42.3 shipped May 2026.

**API shape.** Two modes: YAML rules and Node-API JS programmatic.

```bash
# CLI one-liner
ast-grep --pattern 'console.log($X)' \
         --rewrite 'logger.info($X)' \
         --lang typescript src/
```

```yaml
# rule file: silent-catch.yml
id: silent-catch
language: typescript
rule:
  pattern: |
    catch ($E) { }
fix: |
  catch ($E) { logger.error({ err: $E }, 'unhandled'); }
```

Programmatic (NAPI):

```ts
import { parse } from '@ast-grep/napi';
const root = parse('typescript', source).root();
const matches = root.findAll({ rule: { pattern: 'console.log($X)' } });
for (const m of matches) {
  edits.push(m.replace('logger.info($X)'));
}
const newSrc = root.commitEdits(edits);
```

**Output preservation.** Best in class. ast-grep is built on a CST (concrete syntax tree) instead of an AST, so comments, whitespace, and even unusual indentation are part of the tree by construction. [Rewrite Code docs](https://ast-grep.github.io/guide/rewrite-code.html) call out "the indentation level of a meta-variable in the fix string is preserved in the rewritten code." In practice: if you only match a `CallExpression`, only that `CallExpression`'s span is replaced; everything outside is byte-identical.

**Speed.** Order of magnitude faster than ts-morph for pure syntactic match-and-replace because (a) Rust + parallel, (b) no `tsc` semantic phase. Sub-second on 500 TS files is realistic; the [ast-grep landing page](https://ast-grep.github.io/) cites "blazing fast search and replace across thousands of source code files, powered by parallel Rust." Treat with mild skepticism — the only credible number we found is GritQL's "10M+ lines in seconds" claim, which is roughly the same ballpark.

**Adoption.** Codemod.com platform (their `jssg` runtime), Biome 2.0 (via the GritQL plugin which uses a similar tree-sitter base), the NPM registry shows tens of thousands of weekly downloads (much lower than jscodeshift). Real production users: Codemod's customer codemods, a few Sentry/Vercel migration scripts. Not yet at jscodeshift's level of enterprise adoption.

**Cons.** No type information. If we need "is this `console` actually the global `console`, or shadowed by `import { console } from 'somewhere'`?", ast-grep cannot answer — for that we need ts-morph. Also: distributing a Rust binary via npm `optionalDependencies` means our `npm install` downloads ~50 MB per platform; cross-platform releases are sometimes a release-day shuffle. (Compare jscodeshift's pure-JS install — slower at runtime but no platform binary headaches.)

**Verdict for ZeroU.** A strong candidate for **#1 and #2 *if* we ever feel the need to upgrade off regex without going full ts-morph**. The YAML rules read like a more disciplined cousin of our current regex. But: it adds a 50 MB binary dep for two transformations that already work, and we lose the option to do type-aware transforms later. Pick ts-morph instead and we get the same syntactic power plus type info, for ~30 MB less.

---

## 4. Comby

**Provenance.** Built in 2019 by Rijnard van Tonder (Stripe alum, then Sourcegraph). The hook is: "language-agnostic structural replace" — one template syntax that respects balanced delimiters, strings, and comments for every language. Sourcegraph's structural-search backend is comby; some teams at Stripe and Sourcegraph use it for one-off mass refactors.

**API shape.** Pure CLI / template-based, no programming language required.

```bash
# console.log(args) → logger.info(args), respects string boundaries
comby 'console.log(:[args])' 'logger.info(:[args])' .ts -in-place

# catch (e) {} → catch (e) { logger.error({err: e}, 'unhandled'); }
comby 'catch (:[name]) { }' \
      'catch (:[name]) { logger.error({ err: :[name] }, "unhandled"); }' \
      .ts -in-place
```

The `:[hole]` metavariables match balanced expressions including nested parens, brackets, and strings, which is what regex can't do.

**Output preservation.** Excellent — comby only touches the matched span and leaves everything else (whitespace, comments, file encoding) verbatim. This is closer to `sed` semantics than to AST round-tripping.

**Cons.**
- It's an OCaml binary, ~20 MB, *not on npm*. Distributing it inside a Node CLI means either (a) bundling per-platform binaries we maintain ourselves, or (b) requiring users to `brew install comby` separately. Either way, friction.
- No real type info. Sourcegraph's hosted type-on-hover integration is the only path to "type-aware" comby, and that's a server-side feature, useless to ZeroU running locally.
- Project activity is low in 2024–2026. The team shipped Comby v1.9.1 long ago and has largely moved on.

**Verdict for ZeroU.** Tactical only. The DSL is shockingly close to our regex-based mental model and would survive nested-paren cases that our current regex won't. But the distribution story for a Node CLI is bad, and we'd be inheriting a tool whose own author is no longer pushing it. **Skip.**

---

## 5. swc/babel plugins (compile-time)

This category is worth surveying briefly to **rule it out** — it solves a different problem than ZeroU.

**Compile-time transforms** (swc plugin, babel plugin) execute every time the user's code is compiled. The source on disk is unchanged; the *emitted JS* is modified. Real production examples:
- [`babel-plugin-istanbul`](https://github.com/istanbuljs/babel-plugin-istanbul) — injects coverage instrumentation
- [`babel-plugin-console-log`](https://www.npmjs.com/package/babel-plugin-console-log) — rewrites `console.log` calls
- [Heap's React Native analytics](https://www.heap.io/blog/how-we-leveraged-asts-and-babel-to-capture-everything-on-react-native-apps) — wraps every component with telemetry
- New Relic's browser agent and the amphtml `babel-plugin-transform-log-methods` — inject logger context at compile time
- swc WASM plugins for the same idea, faster

```js
// babel plugin sketch
export default function ({ types: t }) {
  return {
    visitor: {
      CallExpression(path) {
        const callee = path.node.callee;
        if (t.isMemberExpression(callee) &&
            t.isIdentifier(callee.object, { name: 'console' })) {
          callee.object = t.identifier('logger');
          callee.property = t.identifier({
            log: 'info', info: 'info', warn: 'warn',
            error: 'error', debug: 'debug',
          }[callee.property.name] ?? 'info');
        }
      },
    },
  };
}
```

**Why this is the wrong tool for ZeroU.** ZeroU's product promise is "we modify the user's source files so the next reviewer / engineer / git diff can see what changed." A compile-time plugin produces no source-file diff, no commit to inspect, no "追溯" (traceability — see `project_zerou_core_value_4tiers`). It also requires us to inject a build-config change into the user's project (`babel.config.js` or `.swcrc`), which is itself a multi-tool-chain footgun (Next.js uses swc-by-default, CRA uses babel, Vite uses esbuild, etc.). Hard skip.

---

## 6. Raw TS Compiler API (with transformers)

This is the foundation ts-morph is built on, and we already use the read-only half of it in `ast-analyzer.ts`. The mutation API exists via `ts.transform(sourceFile, [transformer], compilerOptions)` plus `ts.createPrinter({ removeComments: false }).printFile(transformed)`.

**API shape.**

```ts
import ts from 'typescript';

const transformer = <T extends ts.Node>(ctx: ts.TransformationContext) => {
  const visit: ts.Visitor = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'console'
    ) {
      const mapped = {
        log: 'info', info: 'info', warn: 'warn',
        error: 'error', debug: 'debug',
      }[node.expression.name.text] ?? 'info';
      return ctx.factory.updateCallExpression(
        node,
        ctx.factory.createPropertyAccessExpression(
          ctx.factory.createIdentifier('logger'),
          ctx.factory.createIdentifier(mapped),
        ),
        node.typeArguments,
        node.arguments,
      );
    }
    return ts.visitEachChild(node, visit, ctx);
  };
  return (node: T) => ts.visitNode(node, visit) as T;
};

const result = ts.transform(sourceFile, [transformer]);
const printed = ts.createPrinter({
  newLine: ts.NewLineKind.LineFeed,
  removeComments: false,
}).printFile(result.transformed[0]);
```

**Pros.** Zero added dep (we already ship `typescript`). Full type info if we set up a `Program`. Microsoft-maintained, no third-party churn risk.

**Cons.**
- **The printer reformats every subtree it touches.** [Issue #30191](https://github.com/microsoft/TypeScript/issues/30191) — `ts.setSyntheticLeadingComments` doesn't dedupe existing comments, leading to comment duplication. Comments are *trivia*, not nodes, so once you go through `factory.update*` + `printFile`, the printer re-emits the subtree from scratch — single quotes become double, your custom multi-line formatting collapses, etc.
- **Verbose.** The example above is ~25 lines for what ts-morph does in 6. Multiplied across N transforms, this is *real* maintenance cost.
- **`factory` API churn.** The transformer factory was renamed in TS 4.0, deprecated in 4.5, and the migration path is still painful in dependencies that pre-date it.

Production users: `tsc-alias`, TypeORM migrations generator, Nx generators (which actually wrap ts-morph), and Angular's own internal codemods (which use ts-morph). The pattern is: **wrap the compiler API** rather than use it directly. We should do the same.

**Verdict for ZeroU.** Use this directly only for *one-off, throwaway* transforms where adding a dep is not worth it. For everything else: ts-morph is exactly this API plus the missing-batteries.

---

## 7. Direct comparison for ZeroU's two transformations

Pseudo-code per tool, plus a per-transform winner.

### (a) Silent-catch rewrite — `catch (e) {}` → `catch (e) { logger.error({err: e}, 'unhandled'); }`

| Tool | Pseudo-code | Notes |
|---|---|---|
| Current regex | `/catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{\s*(\}\|return\s+...)/g` | Works for the canonical shape we target. Brittle on `catch { ... }` (TS 4.0+ optional catch binding) and on bodies that *also* match but contain unrelated code. Our regex sidesteps that by only matching empty-body / single-return shapes — fine but narrow. |
| jscodeshift | `j.CatchClause` filter on `body.body.length === 0 \|\| ...` then `path.node.body = j.blockStatement([logCall, ...origReturn])` | Re-prints the entire `try`/`catch` — drops JSDoc above the surrounding function in our experience. ❌ |
| ts-morph | `sf.getDescendantsOfKind(SyntaxKind.CatchClause).forEach(cc => { const blk = cc.getBlock(); if (blk.getStatements().length === 0) blk.insertStatements(0, logLine); })` | Textual insertion; surrounding code untouched. ✅ |
| ast-grep | YAML rule with `pattern: catch ($E) { }` + `fix: catch ($E) { logger.error({ err: $E }, 'unhandled'); }`. Second rule for the `return null` variant. | Cleanest of all. Two rules in a YAML file replace ~20 LOC of regex. ✅ |
| Comby | `comby 'catch (:[e]) { }' 'catch (:[e]) { logger.error(...); }' .ts` | One-liner. ✅ but distribution headache. |
| TS Compiler API | `ts.transform` visitor on `CatchClause` nodes | Verbose, comment-trivia risk. ~ |

**Winner: ast-grep**, with ts-morph a close second. Regex is *acceptable* but ages badly the moment we want a variant.

### (b) `console.log → logger.info` family

| Tool | Pseudo-code | Notes |
|---|---|---|
| Current regex | `/console\s*\.\s*(log\|info\|warn\|error\|debug)\s*\(/g` | Fine, except it doesn't notice if someone has imported a local `console` symbol. Cost of that mistake: low (we'd log to `logger` instead of `console`, which is *probably the intent anyway*). |
| jscodeshift | `j.find(j.CallExpression, { callee: { object: { name: 'console' }, property: { name: ... } } })` | Drops quote style of unrelated literals if they're in the same `replaceWith` subtree. ❌ |
| ts-morph | Walk `CallExpression`s, check `PropertyAccessExpression` with `getExpression().getText() === 'console'`, then `replaceWithText('logger')` | Crucially, can also use `getSymbol()` to verify it's the *real* global console. ✅ |
| ast-grep | `pattern: 'console.log($X)'` × 5 (one per level) or a more general `pattern: 'console.$M($$$ARGS)'` with a `where` constraint mapping `$M` | Trivially correct. ✅ |
| Comby | `comby 'console.log(:[a])' 'logger.info(:[a])' .ts` × 5 | Trivial. |

**Winner: ast-grep**, with regex as the no-cost-of-entry alternative.

---

## 8. Final recommendation

**Stage 1 (now): keep the regex.** The two transformations in `log-executor.ts:175–230` are line-local, idempotent, and shipped. Replacing them right now buys us no user-visible improvement; it costs us a dependency, install-time, and a code-review on the migration PR. The `surface_without_self_test` discipline says: don't introduce new tools without justification.

**Stage 2 (the moment we want transformation #3): adopt `ts-morph`.** The trigger conditions are concrete:
1. We need a transform that operates on *function-shaped* contexts ("wrap every async endpoint", "inject `logger.child()` at the top of every Next.js route handler") — regex cannot find a function boundary.
2. We need to consult *type information* ("only wrap functions whose return type is `Promise<Response>`") — only ts-morph and the raw TS API can do this.
3. We need a transform that survives nested expressions or template literals.

When that day comes, the migration is mechanical:
   a. `pnpm add ts-morph` (delta ~15 MB because we already have `typescript`).
   b. Add `cli/src/enhance/codemod/` directory; first file is `console-to-logger.ts`, a port of the current regex.
   c. Replace the regex with a thin wrapper that calls into ts-morph. Keep the regex *as a fallback* for files that don't parse cleanly (broken TS).
   d. Self-test: add a vitest case per codemod with golden input/output fixtures.
   e. The reviewer pipeline's static gate already runs `tsc --noEmit`, so any ts-morph mistake that produces unparseable TS will fail loudly and visibly — which is the property regex *doesn't* give us.

**Why not ast-grep, even though it scored best on both transformations in §7?** Two reasons. (1) We lose the type-info path that we *know* we need for Phase 11. Doing both ast-grep and ts-morph means we maintain two tools. (2) The 50 MB-per-platform Rust binary in `optionalDependencies` is more cross-platform headache than 15 MB of pure JS. The ast-grep CLI is a great power tool for *humans* doing ad-hoc one-shot refactors; ts-morph is the right *library* for a CLI we ship to users.

**Concrete migration steps when Stage 2 begins:**
1. Open `docs/plans/YYYY-MM-DD-codemod-migration.md` with the four-segment plan.
2. Add `ts-morph` to `cli/package.json`. Pin to `^28.x`.
3. New module `cli/src/enhance/codemod/runner.ts` that owns a single `Project` instance per enhance run (amortise the parse cost — see §2 performance discussion). All codemods receive `Project + SourceFile` and return edit counts.
4. Port `transformSilentCatches` and `transformConsoleCalls` into ts-morph codemods. Keep regex versions in `legacy/` for one release as a safety net.
5. Self-test: golden fixtures under `cli/test/fixtures/codemod/<name>/{input,expected}.ts` plus `runner.spec.ts` walking each pair.
6. Smoke: `node scripts/smoke-walking-skeleton.mjs` must still pass on `fixtures/demo-cli`. Compare runtime — accept up to 3× regex's latency.
7. PR with `feat(enhance): switch log injection to ts-morph` body explaining the *why* (transform #3 is around the corner).

---

## Citations

- **jscodeshift maintenance** — [Issue #587: Maintenance and Future Plans](https://github.com/facebook/jscodeshift/issues/587), [Issue #500: Bringing jscodeshift up to date](https://github.com/facebook/jscodeshift/issues/500), [Issue #482: State of the project](https://github.com/facebook/jscodeshift/issues/482), [Meta repo](https://github.com/facebook/jscodeshift)
- **recast formatting failures** — [Issue #143 (quote styles)](https://github.com/facebook/jscodeshift/issues/143), [Issue #258 (parens move leading comments)](https://github.com/facebook/jscodeshift/issues/258), [Issue #67 (`.replaceWith` drops comments)](https://github.com/facebook/jscodeshift/issues/67), [Recast #268 (var-kind change strips indent)](https://github.com/benjamn/recast/issues/268), [Recast #370 (extra blank lines)](https://github.com/benjamn/recast/issues/370), [Recast #365 (JSX reformat)](https://github.com/benjamn/recast/issues/365)
- **ts-morph** — [Performance docs](https://ts-morph.com/manipulation/performance), [npm page](https://www.npmjs.com/package/ts-morph), [forget gotcha #192](https://github.com/dsherret/ts-morph/issues/192), [Fast Remove #610](https://github.com/dsherret/ts-morph/issues/610), [Codemod AI ts-morph support announcement](https://codemod.com/blog/ts-morph-support), [Sourcegraph codemod collection](https://github.com/sourcegraph/codemod), [AST refactoring with ts-morph](https://kimmo.blog/posts/8-ast-based-refactoring-with-ts-morph/), [ts-migrate blog (Airbnb)](https://medium.com/airbnb-engineering/ts-migrate-a-tool-for-migrating-to-typescript-at-scale-cd23bfeb5cc), [airbnb/ts-migrate repo](https://github.com/airbnb/ts-migrate)
- **ast-grep** — [Project site](https://ast-grep.github.io/), [Rewrite Code guide](https://ast-grep.github.io/guide/rewrite-code.html), [TypeScript catalog](https://ast-grep.github.io/catalog/typescript/), [Binary size issue #1757](https://github.com/ast-grep/ast-grep/issues/1757), [linux-x64 install size](https://npmx.dev/package/@ast-grep/cli-linux-x64-gnu), [Codemod's JSSG announcement](https://codemod.com/blog/jssg), [Hypermod comparison](https://www.hypermod.io/blog/4-jscodeshift-vs-ast-grep)
- **Comby** — [Project site](https://comby.dev/), [Find and replace with type info](https://comby.dev/blog/2022/08/31/comby-with-types), [Sourcegraph structural search](https://sourcegraph.com/blog/going-beyond-regular-expressions-with-structural-code-search), [Faster Refactoring with Comby](https://stefanbuck.com/blog/faster-refactoring-with-comby)
- **swc / babel plugins** — [babel-plugin-istanbul](https://github.com/istanbuljs/babel-plugin-istanbul), [babel-plugin-console-log npm](https://www.npmjs.com/package/babel-plugin-console-log), [Heap's React Native instrumentation](https://www.heap.io/blog/how-we-leveraged-asts-and-babel-to-capture-everything-on-react-native-apps), [amphtml transform-log-methods](https://github.com/ampproject/amphtml/blob/main/build-system/babel-plugins/babel-plugin-transform-log-methods/index.js), [swc plugin getting started](https://swc.rs/docs/plugin/ecmascript/getting-started), [swc plugin cheatsheet](https://swc.rs/docs/plugin/ecmascript/cheatsheet), [@swc/wasm-typescript](https://swc.rs/docs/references/wasm-typescript)
- **TypeScript Compiler API** — [Comment manipulation guide](https://quramy.medium.com/manipulate-comments-with-typescript-api-73d5f1d43d7f), [Compiler API revisited (ScottLogic)](https://blog.scottlogic.com/2017/05/02/typescript-compiler-api-revisited.html), [Custom Transformations Made Simple](https://www.slatebytes.com/articles/exploring-the-typescript-compiler-api-custom-transformations-made-simple), [Issue #30191: synthetic comments dedup](https://github.com/microsoft/TypeScript/issues/30191), [Building a transformer (GSoC '21)](https://medium.com/leopards-lab/building-a-transformer-using-typescript-compiler-api-week-3-gsoc21-5db0bf95ad66)
- **GritQL** — [getgrit docs](https://docs.grit.io/), [biomejs/gritql](https://github.com/biomejs/gritql), [Show HN](https://news.ycombinator.com/item?id=39770908)
