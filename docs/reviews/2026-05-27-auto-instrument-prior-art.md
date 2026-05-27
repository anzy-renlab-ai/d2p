# Auto-Instrumentation Prior Art — Industry Survey

Date: 2026-05-27
Audience: ZeroU eng team (we currently regex-rewrite TS/JS to inject logging)
Question: How do the established players actually do this?

---

## TL;DR (5 bullets)

- **Nobody serious rewrites source files for runtime instrumentation.** OpenTelemetry, Sentry (server-side wrappers excluded), Datadog `dd-trace`, New Relic, and Elastic APM all hook at the **module loader** layer via `require-in-the-middle` (CJS) and `import-in-the-middle` (ESM), then monkey-patch named exports using the `shimmer` pattern (`_wrap` / `_unwrap`).
- **The only place wrap-around-export source rewriting still wins is at framework boundaries that the loader cannot reach** — e.g. Next.js Route Handlers, Server Components, and Server Actions. Sentry handles these via a Webpack loader that targets reserved filenames (`page|layout|loading|head|not-found`) and replaces the default export with `wrapRouteHandlerWithSentry`. Even Sentry admits this misses any file that doesn't match the regex.
- **Compile-time AST tools exist and are mature**, but their job is API migration, not telemetry. `jscodeshift` (Meta), `ts-morph` (Sourcegraph), `ast-grep` (Rust + tree-sitter), and `comby` (structural) all ship to production — but for codebase modernization (React version bumps, lodash→ES, TS migrations), not for injecting `logger.info` calls. There is no famous OSS "log codemod" that runs in CI.
- **"Production-grade logging" is a checklist, not an AST transform.** Twelve-Factor says write JSON to stdout. Susan Fowler's *Production-Ready Microservices* and every modern guide add: structured key=value (or JSON), correlation IDs threaded via `AsyncLocalStorage`, levels, sampling, redaction of secret-shaped fields, and a serializer per shape. `pino` + `pino-http` is the de facto stack and it is library-driven, not codemod-driven.
- **For ZeroU, this means the regex approach is on the wrong side of the fork.** The real production answer is: (i) drop in `pino` + `pino-http` + a request-id middleware, (ii) wire `AsyncLocalStorage` for correlation, (iii) configure `redact` paths from a heuristic scan, (iv) leave business code alone. Source rewriting should only target the **bootstrap files** (entry, server, middleware chain), not function bodies.

---

## 1. Runtime hooking vs source transformation: the fundamental fork

Two roads to "automatic" instrumentation:

| Approach | Where it acts | Examples | Cost |
|---|---|---|---|
| **Runtime hooking** | `Module._load` (CJS) or ESM loader hook | OpenTelemetry, dd-trace, New Relic, Elastic APM, Sentry SDK runtime tracing | Zero source diff, runs always-on, fragile across ESM versions |
| **Build-time wrapping** | Webpack/SWC/Babel loader | Sentry Next.js (route wrappers), Sentry SvelteKit, Next.js OTel preview | Survives bundling, scoped to known filenames, requires bundler |
| **Source rewriting (codemod)** | AST transforms on disk | `jscodeshift`/`ts-morph` migrations; **no famous logging codemod** | Permanent diff, reviewable, ages with the code, brittle to formatting |

The big observation: **all three major APM vendors picked runtime hooking** for the same reason — it works on code they didn't write, supports hundreds of libraries, and survives `npm update`. Source rewriting is reserved for cases where the loader literally cannot intercept (Next.js compiles server components into Webpack modules with synthetic names; the module loader sees the bundle, not the user's file).

---

## 2. OpenTelemetry / Sentry / Datadog: how they actually do it

### OpenTelemetry (`@opentelemetry/auto-instrumentations-node`)

Pure monkey-patching at module load time. The flow:

1. User runs `node --require '@opentelemetry/auto-instrumentations-node/register' app.js`.
2. The register script calls `NodeSDK.start()`, which iterates registered `Instrumentation` plugins.
3. Each plugin extends `InstrumentationBase` and overrides `init()` to return one or more `InstrumentationNodeModuleDefinition` objects naming the target module (e.g. `'express'`, `'pg'`, `'http'`) plus a version range.
4. `InstrumentationBase` registers callbacks with `require-in-the-middle` (CJS) and `import-in-the-middle` (ESM). The hook fires on the next `require('express')` or `import express from 'express'`.
5. Inside the hook, the plugin calls `this._wrap(moduleExports, 'methodName', original => wrapped)`. `_wrap` is a thin re-export of `shimmer.wrap` and attaches `__original` / `__unwrap` / `__wrapped` marker properties to the wrapped function (the `ShimWrapped` interface).
6. `_unwrap` in `disable()` restores the original.

Critical timing requirement: **hooks must be registered before the target module loads**, otherwise the cached `module.exports` reference is already in callers' closures and patching is too late. This is why `--require` (CJS) or `--import` (ESM) is mandatory — `import './tracing.js'` at the top of `app.ts` is too late under bundlers and sometimes under raw ESM.

Reference: `open-telemetry/opentelemetry-js` repo, package `@opentelemetry/instrumentation`, class `InstrumentationBase`.

### Sentry — two modes

**`@sentry/node` runtime tracing**: same monkey-patch pattern as OTel, layered on top of `import-in-the-middle`. Sentry actually adopted OpenTelemetry's instrumentation libraries internally in v8.

**`@sentry/nextjs` route wrappers**: this is where it gets interesting and it's the only well-known production deployment of *source-level wrap-around-export* in the JS ecosystem:

- A custom Webpack loader scans for files matching the regex `page|layout|loading|head|not-found` (literal Next.js reserved names) in the `app/` directory and for files in `pages/api`.
- For each match, it generates a synthetic module that imports the user's default export, wraps it with `wrapRouteHandlerWithSentry`, and re-exports it.
- The wrapper uses a JavaScript `Proxy` with an `apply` trap so it intercepts every invocation including odd calling conventions.

**What it does NOT catch**, by Sentry's own admission (GH discussion 13442):

- Nested server components with custom (non-reserved) filenames — users have to manually call the undocumented `wrapServerComponentWithSentry`.
- Server component errors in Next.js <15 (a Next.js platform limitation, not Sentry's).
- Anything outside `app/` or `pages/api`.

This is the most relevant prior art for ZeroU's "rewrite the user's file" instinct, and it shows the cost: the wrap-around is **opt-in by filename convention** and still leaks holes.

### Datadog `dd-trace`

Same module-load interception via `require-in-the-middle` and Datadog's own `import-in-the-middle` (Datadog *wrote* `import-in-the-middle`, now donated to the Node.js org). Datadog claims 200+ supported libraries.

Async context propagation: dd-trace historically used `async_hooks` to track async chains; this had a documented incompatibility with user-level `AsyncLocalStorage` (issues #2056, #4557) where ALS contexts get lost across boundaries. The fix path has been to use ALS itself as the propagation mechanism, but the legacy `async_hooks` plumbing still bites.

### New Relic + Honeycomb Beeline

- New Relic `newrelic` package: same model — `require()` interception + library-specific shim modules (e.g. `node-newrelic-koa`, `node-newrelic-superagent`). Most standalone shims are now folded into the core agent.
- Honeycomb Beeline **was deprecated and EOL'd August 2025**. Honeycomb officially redirects users to OpenTelemetry. Beeline never supported ESM or bundlers, which contributed to its death.

The trend is unanimous: the industry consolidated on OpenTelemetry's hook stack.

---

## 3. The `require-in-the-middle` / `import-in-the-middle` pattern

### CJS — `require-in-the-middle`

Patches Node's internal `Module._load`. Pseudocode:

```js
const Module = require('module');
const orig = Module._load;
Module._load = function (request, parent, ...rest) {
  const exports = orig.call(this, request, parent, ...rest);
  if (registeredModules.has(request)) {
    return runHook(request, exports);   // hook returns possibly-replaced exports
  }
  return exports;
};
```

This works because in CJS, every `require()` is a synchronous function call that resolves through `Module._load`. Every consumer of `require('express')` re-enters `_load` and gets whatever the hook returns.

### ESM — `import-in-the-middle`

Maintained at `nodejs/import-in-the-middle` (donated by Datadog). Uses Node's `module.register()` loader API and provides a `Hook(['package'], (exports, name, baseDir) => { ... })` callback.

**Caveats (from README and tracked issues)**:

1. **Cannot add new exports** — only mutate existing ones. ESM's static binding analysis is set at parse time.
2. **Dynamic imports cannot be retroactively altered** after first load.
3. **`export *` is not interceptable in Node 20** because the loader uses AST parsing and `export *` is not a real named export.
4. **Import assertions** (`with { type: 'json' }`) need explicit handling and have caused open issues.
5. **CJS modules loaded via `require()` inside an ESM app are not affected** — you need both hooks running.
6. Loader API has shifted across Node 18 / 20 / 22; `import-in-the-middle` papers over the differences but is sensitive to Node versions.

This is why Elastic APM still labels ESM support "experimental" (issue #1952) and why most OTel docs recommend running with both `--require` and `--import` flags.

### The `shimmer` library

`shimmer` is the ~70-line library every APM agent imports. Its core is `shimmer.wrap(nodule, name, wrapper)`:

```js
function wrap(nodule, name, wrapper) {
  const original = nodule[name];
  const wrapped = wrapper(original, name);
  wrapped.__original = original;
  wrapped.__wrapped = true;
  wrapped.__unwrap = () => { nodule[name] = original; };
  nodule[name] = wrapped;
  return wrapped;
}
```

OTel's `InstrumentationBase._wrap` is a thin wrapper over this. Every "instrumentation" you see in `@opentelemetry/instrumentation-*` reduces to `shimmer.wrap(express.Router.prototype, 'handle', ...)` or similar.

---

## 4. Codemod tools that DO transform source

These tools are mature and used in production, but **not for telemetry** — they're for API migrations.

| Tool | Owner | Engine | Real-world use |
|---|---|---|---|
| **`jscodeshift`** | Meta (facebook/jscodeshift) | recast + babel | React's migration codemods (`react-codemod`), Next.js codemods (`@next/codemod`), Meta's internal React→React 18 transition. **Maintenance mode** per issue #587. |
| **`ts-morph`** | dsherret | TS compiler API | Sourcegraph's `sourcegraph/codemod` repo. Used heavily for TS-aware refactors (rename across files with type checking). Codemod.com's AI codemod platform added ts-morph as an engine alongside jscodeshift. |
| **`ast-grep` (`sg`)** | herrington/ast-grep org | tree-sitter CST in Rust | Fast YAML-rule linter + rewriter. Gaining traction for IDE/CLI structural search. Used by Biome-adjacent projects and shipped in tooling like Sourcegraph Cody. |
| **`comby`** | comby-tools (Stripe-adjacent) | structural patterns (not AST) | Language-agnostic search/replace. Used inside Sourcegraph for cross-repo refactors. Trade-off: not AST-aware, so it can match across syntactic boundaries (more flexible, less safe). |

**Who ships "AST-based log injection" as a feature?** No one famous. The closest:

- Sentry's webpack loader for Next.js (above) — but it wraps exports, not function bodies.
- Various blog post examples of "babel plugin that transforms `console.log` → `console.debug`" — toy demos, not products.
- `pino-pretty-cli` and similar — formatting, not injection.

The reason is structural: **injecting `logger.info` calls into function bodies adds noise and ages badly**. Once injected, the logs are part of the user's source forever; they show up in git blame, they survive `npm uninstall`, and they require a second codemod to remove. The industry decided this is a feature of the **wrong layer** — logs belong in middleware (HTTP entry/exit), in framework hooks (lifecycle), and in error handlers (catch boundaries), not sprinkled in every function.

### AspectJ / AOP digression

AspectJ (Java) is the canonical answer to "I want logging at every method entry without writing it." It works because the JVM has bytecode weaving: `ajc` rewrites compiled `.class` files (or weaves at classload time) to inject pointcuts. There is no native equivalent in JS because:

1. JS has no separate bytecode layer to weave between source and execution.
2. ES modules have static binding semantics that resist post-hoc wrapping.
3. TC39 decorators (stage 3) cover *some* AOP territory but are method/class-level and explicit, not pointcut-based.

The closest JS attempts (`aspect.js` by Minko Gechev, `kaop-ts`) never reached mainstream adoption. The industry settled on **runtime monkey-patching of well-known library entry points** (the OTel approach) and **decorators for explicit boundaries** (NestJS, TypeORM).

---

## 5. What makes a system "production-grade" for logs

Consolidated from Twelve-Factor, Susan Fowler's *Production-Ready Microservices* (O'Reilly), and the pino / OTel guides:

1. **JSON to stdout, unbuffered.** App never owns rotation, never owns shipping. (12-factor logs §XI)
2. **One line = one event = one JSON object.** No multiline stack traces inline — serialize via `err` serializer.
3. **Levels** — at minimum `trace/debug/info/warn/error/fatal`. Default prod level is `info`. Pino uses these by default.
4. **Correlation ID** generated at the entry edge (HTTP middleware, queue consumer, scheduler) and propagated via `AsyncLocalStorage`. Header convention is `x-correlation-id` or W3C `traceparent`. Every log line in the request lifetime carries it.
5. **Structured serializers** — `pino.stdSerializers.req` shaves a raw `IncomingMessage` down to `{ method, url, headers, remoteAddress, remotePort }`; `pino.stdSerializers.res` to `{ statusCode, headers }`; `pino.stdSerializers.err` to `{ type, message, stack, code }`. Without serializers you log circular objects and PII-laden full headers.
6. **Redaction** at the logger config layer: `pino({ redact: { paths: ['*.password', '*.token', 'req.headers.authorization', '*.creditCard'], censor: '[REDACTED]' } })`. Critical caveat: pino's redact paths must match the actual nesting; sensitive fields move when shapes change.
7. **Child loggers** per module/service: `const log = parent.child({ component: 'payments' })` so filters in the aggregator are free.
8. **Sampling** for high-volume info logs; never sample errors.
9. **Health checks excluded** from request logs (`pino-http` ignores via `autoLogging.ignore`).
10. **HTTP boundary instrumented once**: `pino-http` is the standard middleware. The framework wrap-around pattern (wrap `app.use`, wrap `Router.prototype.handle`) is what every APM agent ends up doing under the hood.

"Production-grade" is achieved by **library composition + config**, not by injecting log calls into every function.

---

## 6. Specific recommendations for ZeroU

Three paths. Pick honestly.

### Path A — Harden the regex (cheap, keeps current architecture)

**Effort**: ~3 days

**What we do**:
- Keep regex but narrow scope to **bootstrap files only** (`index.ts`, `app.ts`, `server.ts`, files matching `**/middleware/**`, `**/server/**`).
- Replace whole-file replacement with **anchored insertions**: append a `pino` bootstrap, prepend a `pino-http` middleware before the first `app.use` (locate via regex), wrap the first `try { ... } catch (e) { /* silent */ }` we find.
- Add a `--dry-run` diff preview and require user approval before write.
- Ship a regression suite of ~20 sample apps where we know the expected diff.

**What users gain**: structured logging at the HTTP boundary on day 1, working pino config, no surprise function-body edits.

**What we lose**: still fragile against weird formatting (comments inside `catch`, multi-line silent catches across boundaries), still no understanding of imports, still can't refactor inside async functions.

### Path B — Pivot to `ts-morph` codemod (medium, what we should probably do)

**Effort**: ~2 weeks

**What we do**:
- Replace regex with `ts-morph` for the bootstrap file edits. Same target (entry files + middleware), but now we:
  - Parse the file, locate the actual `Express` app variable via type inference, insert `app.use(pinoHttp(...))` immediately after instantiation.
  - Find `CatchClause` nodes whose body is empty or contains only a `console.log` and replace the body with `logger.error({ err: <param> })`.
  - Find `CallExpression`s where the callee is `console.log/info/warn/error` and rewrite to the logger import (only when the import resolves cleanly — otherwise skip and report).
  - Add the `import pino from 'pino'` at the top, idempotently.
- Surface a structured **report** of what we changed + what we declined to change + why. ZeroU's "追溯" tier (traceback) gets first-class data here — every edit has an AST-node anchor and a justification string.
- Keep `--dry-run` and per-edit approval.

**What users gain**: AST-aware, idempotent, survives reformat, gives ZeroU's reviewer pipeline a real diff to attest. The 追溯 layer becomes meaningful instead of best-effort. Failure mode shifts from "scrambled file" to "skipped with reason".

**What we lose**: ts-morph is slow on large repos (TS program load). Need a hot-loaded compiler instance, careful project boundary detection. Tests get harder (need fixtures of real TS projects, not strings).

### Path C — Pivot to runtime instrumentation (big shift, matches what the industry does)

**Effort**: ~4 weeks + ongoing maintenance per supported framework

**What we do**:
- Drop source rewriting for *function-body logging entirely*.
- Ship `@zerou/runtime` — a tiny package that registers via `--require @zerou/runtime/register` and uses `require-in-the-middle` + `import-in-the-middle` to wrap `express`, `fastify`, `koa`, `http`, `node:fetch`, and the major DB drivers. Each wrapper threads a correlation ID via `AsyncLocalStorage` and emits structured pino logs.
- ZeroU's codemod role shrinks to **bootstrap-only**: insert the `--require` flag into `package.json` scripts, add a `zerou.config.ts`, and stop.

**What users gain**: zero source diff in business code, survives `npm update`, matches the OTel model users expect from production tooling.

**What we lose**:
- Our differentiator (the codemod that *demonstrates* fixes) gets less visible. The product becomes "another APM agent". 追溯 has to be re-thought — what does "traceback of a fix" mean when there's nothing in the diff?
- Maintenance burden of per-library shims (the OTel community has 50+ packages for a reason).
- ESM is still messy; `import-in-the-middle` caveats are real (no `export *`, no dynamic mutation, import assertions).
- We compete head-to-head with OTel + pino-http instead of complementing them.

### Honest recommendation

**Path B**, with Path C as a future option for a "ZeroU Pro" runtime mode.

Reasoning:
- ZeroU's value prop is **visible, reviewable, attributable code change** — the 4-tier 扫+修+验+追溯 only makes sense if there's a diff to attribute. Path C erases the diff.
- Path A's failure modes (scrambled files, false positives) will be the dominant user complaint within weeks of broader use. Hardening regex is delaying the inevitable.
- Path B keeps the product identity (we write code) but anchors it to real syntax. Reviewer pipeline can attest at the AST-node level. 追溯 has a concrete data structure.
- Path C is the right answer for an APM agent. ZeroU is not an APM agent; it's a hardener that ships a diff. If we want to be both, do B first and add a runtime mode later.

---

## 7. Citations

- [The Twelve-Factor App — Logs (factor XI)](https://12factor.net/logs) — Canonical source for "write to stdout, never own rotation".
- [SigNoz: How OpenTelemetry Auto-Instrumentation Works](https://signoz.io/blog/opentelemetry-auto-instrumentation/) — Best deep-dive on `require-in-the-middle` + shimmer.
- [Last9: How OpenTelemetry Auto-Instrumentation Works](https://last9.io/blog/how-opentelemetry-auto-instrumentation-works/) — Covers the timing constraint (hooks must register before modules load).
- [npm: `@opentelemetry/auto-instrumentations-node`](https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-node) — The umbrella package and its `--require` usage.
- [OpenTelemetry JS: `InstrumentationBase` class](https://open-telemetry.github.io/opentelemetry-js/classes/_opentelemetry_instrumentation.InstrumentationBase.html) — The `_wrap` / `_unwrap` API every instrumentation extends.
- [OpenTelemetry JS: `ShimWrapped` interface](https://open-telemetry.github.io/opentelemetry-js/interfaces/_opentelemetry_instrumentation.ShimWrapped.html) — The `__original` / `__unwrap` markers on wrapped functions.
- [GitHub: `nodejs/import-in-the-middle` README](https://github.com/nodejs/import-in-the-middle/blob/main/README.md) — Authoritative ESM hook API and the four ESM caveats.
- [Elastic APM: ECMAScript module support](https://www.elastic.co/docs/reference/apm/agents/nodejs/esm) — Real-world ESM limitations from a shipping agent.
- [Sentry docs: Next.js automatic instrumentation](https://docs.sentry.io/platforms/javascript/guides/nextjs/tracing/instrumentation/automatic-instrumentation/) — The Webpack-loader + filename-regex approach.
- [GitHub: Sentry Next.js auto-instrumentation discussion #13442](https://github.com/getsentry/sentry-javascript/discussions/13442) — Sentry maintainers explaining what nested server components don't get caught.
- [GitHub: Sentry PR #5778 — "Auto-wrap API routes"](https://github.com/getsentry/sentry-javascript/pull/5778) — The original Webpack loader implementation.
- [Datadog `dd-trace-js` repo](https://github.com/Datadog/dd-trace-js) — 200+ library shims, same monkey-patch model.
- [GitHub issue: dd-trace breaks AsyncLocalStorage #2056](https://github.com/DataDog/dd-trace-js/issues/2056) — Concrete example of why context propagation is hard.
- [New Relic Node.js agent docs](https://docs.newrelic.com/docs/apm/agents/nodejs-agent/installation-configuration/nodejs-agent-configuration/) — Same instrumentation model, agent-style packaging.
- [Honeycomb Beeline EOL announcement](https://docs.honeycomb.io/troubleshoot/product-lifecycle/recommended-migrations/migrate-from-beelines/nodejs) — Beelines died Aug 2025; everyone migrated to OTel.
- [GitHub: `facebook/jscodeshift`](https://github.com/facebook/jscodeshift) — Meta's codemod toolkit. Used for React/Next.js migrations, not logging.
- [Maintenance announcement: jscodeshift issue #587](https://github.com/facebook/jscodeshift/issues/587) — jscodeshift is in maintenance mode.
- [GitHub: `sourcegraph/codemod`](https://github.com/sourcegraph/codemod) — Production ts-morph codemods.
- [Codemod.com blog: ts-morph support](https://codemod.com/blog/ts-morph-support) — Why ts-morph alongside jscodeshift.
- [ast-grep homepage](https://ast-grep.github.io/) and [tool comparison](https://ast-grep.github.io/advanced/tool-comparison.html) — CST-based pattern matching, tree-sitter, comparison with comby.
- [comby docs](https://comby.dev/) — Structural search/replace, language-agnostic.
- [Martin Fowler: Refactoring with Codemods to Automate API Changes](https://martinfowler.com/articles/codemods-api-refactoring.html) — Industry framing of what codemods are for.
- [Dash0: Production-Grade Logging in Node.js with Pino](https://www.dash0.com/guides/logging-in-node-js-with-pino) — Best single-page reference for production pino config.
- [Better Stack: Complete Guide to Pino Logging](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/) — Covers serializers, redact, child loggers, pino-http.
- [DEV: Node.js Structured Logging in Production](https://dev.to/axiom_agent/nodejs-structured-logging-in-production-pino-correlation-ids-and-log-aggregation-262m) — Correlation IDs via middleware + CLS.
- [DEV: Redacting Secrets from Pino Logs](https://dev.to/francoislp/nodejs-best-practices-redacting-secrets-from-pino-logs-1eik) — Pitfalls with nested-path redact filters.
- [Honeycomb: Twelve-Factor Apps and Modern Observability](https://www.honeycomb.io/blog/twelve-factor-apps-modern-observability) — How 12-factor logging evolved into OTel.
- [Minko Gechev: AOP in JavaScript](https://blog.mgechev.com/2015/07/29/aspect-oriented-programming-javascript-aop-js/) — Why JS never got AspectJ; decorators as the partial answer.
- [`aspect.js` repo](https://github.com/mgechev/aspect.js/) — The most-starred attempt at JS AOP; barely used.
