# Phase 1.5 Cross-Track Invariant Audit

> Audit of 4 patched public-surface files for cross-track inconsistencies. Written by a fresh subagent that did NOT read any spec, test, or comparison-report file.
>
> Date: 2026-05-25
> Surface commit audited: `b01959283a8ecd8d3e8665ce290eb09045435983`

## Files audited

- `docs/details/12-log-module-public-surface.md` (LOC: 202)
- `docs/details/13-protocol-2-public-surface.md` (LOC: 375)
- `docs/details/14-protocol-1-public-surface.md` (LOC: 312)
- `docs/details/15-hardener-cli-public-surface.md` (LOC: 360)

Also read for shared vocabulary: `CONTEXT.md`.

## Findings

### Finding 1 — Critic-engine method name disagreement (`call` vs `callJson`)

**Type**: contract contradiction (shared-type method name mismatch)

**Surfaces involved**: `13-protocol-2`, `14-protocol-1`

**Surface A says** (`14-protocol-1-public-surface.md:55-65`):

```
// What P1 invokes on the critic engine.
export interface MinimalCriticEngineSurface {
  // Returns the raw model response as a string. P1 parses to JSON internally.
  call(prompt: string, opts?: {
    schema?: ZodSchema;   // optional structured-output hint; engine may ignore
    timeoutMs?: number;
  }): Promise<string>;
  ...
}
```

**Surface B says** (`13-protocol-2-public-surface.md:128-134`):

```
// Testing note (CriticPolicy construction for unit tests of runPreset):
//   For unit tests of runPreset that exercise llm-judgment rules, construct a
//   CriticPolicy per Protocol-1's surface (§Core types) with a mock LLMEngine
//   whose `callJson(prompt, opts)` returns a value matching the rule's expected
//   schema. The mock engine implements only the LLMEngine interface — no real
//   network access is required. This is the supported path for positive
//   llm-judgment test coverage of runPreset.
```

**Why this matters**: Protocol-2 instructs test authors to stub `callJson(...)`, but Protocol-1 declares that P1 only invokes `call(...)` on the critic engine and parses JSON internally. A mock that implements `callJson` and not `call` will never be invoked under Protocol-2's `runPreset → critic` path (if it routes through Protocol-1 at all), or under any direct P1 entry point. The exact method test authors are supposed to mock is undefined — the two surfaces disagree.

**Suggested fix**: Pick one method name in `MinimalCriticEngineSurface` and have both surfaces reference it verbatim. Either (a) rename to `callJson` and have P1 declare it returns parsed JSON, or (b) keep `call` returning a string and update Protocol-2's testing note to use `call` with a JSON-stringified mock return.

---

### Finding 2 — Engine identity field name drift (`kind` vs `engineKind`) inside the same EvidenceBundle

**Type**: naming drift (shared-shape inside one artifact)

**Surfaces involved**: `14-protocol-1`, `15-hardener-cli`

**Surface A says** (`14-protocol-1-public-surface.md:27-32`):

```
export interface CriticInfo {
  engineKind:  string;     // e.g. 'anthropic-api'
  modelId:     string;     // e.g. 'claude-haiku-4-5-20251001'  (FULL model id, per Q5 micro)
  releaseDate: string;     // ISO 8601 date of the modelId's release, e.g. '2025-10-01'
  family:      string;     // see family taxonomy below
}
```

`VerdictedFinding.critic: CriticInfo | null` therefore exposes the per-engine identifier as the field **`engineKind`**.

**Surface B says** (`15-hardener-cli-public-surface.md:148-161`):

```
    engineConfig: {
      worker: {
        kind:        string;
        modelId:     string;        // FULL model id, e.g. 'claude-haiku-4-5-20251001'
        releaseDate: string;        // ISO date
        family:      string;
      };
      critic: {                     // null when no crossFamily critic was found
        kind:        string;
        modelId:     string;
        releaseDate: string;
        family:      string;
      } | null;
```

**Why this matters**: A single EvidenceBundle written by the hardener CLI contains both shapes simultaneously: `bundle.audit.engineConfig.worker.kind` and `bundle.findings[i].critic.engineKind` (because `findings: VerdictedFinding[]` per Protocol-1). Bundle consumers (P3 readers, deployment-check adapters) will have to remember that the same concept is named two different ways depending on which key they descend through. This is exactly the kind of trap that bundle-merge logic and downstream JSON-schema validators are most likely to get wrong.

**Suggested fix**: Unify on one of `kind` or `engineKind`. Cheapest path: rename `CriticInfo.engineKind` → `CriticInfo.kind` in Protocol-1 to match the EngineConfig vocabulary already used by hardener and (implicitly) by `core/engines/types`.

---

### Finding 3 — Protocol-1 log events claim `track='critic'` but the inheritance rule moves them under the caller's track

**Type**: contract contradiction (logger convention)

**Surfaces involved**: `12-log`, `14-protocol-1`, `15-hardener-cli`

**Surface A says** (`14-protocol-1-public-surface.md:116-121`):

```
**Logger track resolution (`track='critic'`)**: When `opts.logger` is supplied, Protocol-1 creates an internal child logger via `opts.logger.child('critic')` to scope its events. This means:

- `entry.track === opts.logger.track` (P1 inherits the caller's track; it does NOT override).
- `entry.scope` equals `<parent-scope>.critic` if the parent logger has a scope, else just `'critic'`.
```

**Surface A also says** (`14-protocol-1-public-surface.md:282`):

```
## Self-emitted log events under `track='critic'`
```

…and the test-author note (`14-protocol-1-public-surface.md:123`) says tests must construct the injected logger with `track: 'critic'` for `captureLogsFor({ track: 'critic' }, ...)` to match.

**Surface B says** (`15-hardener-cli-public-surface.md:316-346`):

The hardener CLI defines its own `track='cli'` and lists `cli.policy` and other CLI-prefixed events. There is no clause in the hardener surface that says the CLI passes a logger with `track='critic'` to `reviewBatch` / `reviewFinding` / `proposeFix`; the natural implementation is for the CLI to hand its own `track='cli'` logger (or a `child('verdict')` of it) to Protocol-1.

**Surface C says** (`12-log-module-public-surface.md:107-112`):

```
- `track` equals the parent's `track`.
- `trace` equals the parent's `trace`.
- Every entry it writes carries a `scope` field equal to:
  - the supplied `scope` string if called on a root logger,
  - the parent's `scope` joined with `.` and the supplied string if called on an already-scoped logger.
```

So `child(scope)` never mutates `track`. If the CLI's `track='cli'` logger flows in, every P1 event lands under `track='cli'` with `scope='critic'` (or `'verdict.critic'`).

**Why this matters**: Under realistic production wiring (CLI → P1) the events documented as "under `track='critic'`" actually serialize under `track='cli'`. Bundle/log readers and any test that filters by `track: 'critic'` will silently see zero events in production runs, only in P1-as-library tests. This contradicts the section header and the table heading in Protocol-1's own surface.

**Suggested fix**: Two consistent paths to choose between:
(a) Force P1 to always emit under `track='critic'` (i.e. internally call `createTrackLogger('critic', { trace: opts.logger.trace })` instead of `opts.logger.child('critic')`) and reword §"Logger track resolution" to drop the inheritance clause; OR
(b) Keep inheritance and rename the section to "Self-emitted log events under `scope='critic'`" with an explicit note that the `track` is whatever the caller supplies. Then add a normative line in the hardener surface specifying which track the CLI uses when wiring P1.

---

### Finding 4 — Protocol-2 says `appliesTo` is "consumed upstream … by the hardener CLI", but the hardener surface never documents that consumption

**Type**: cross-track causality (dependency declared in one surface, missing in the other)

**Surfaces involved**: `13-protocol-2`, `15-hardener-cli`

**Surface A says** (`13-protocol-2-public-surface.md:186`):

```
- **`appliesTo`** is **advisory** in v0.2. `runPreset` does **not** filter rules against `appliesTo` and does **not** accept a project-type argument. Consumption of `appliesTo` happens upstream — e.g. the hardener CLI uses it when selecting which presets to load for a given project type. Tests against `runPreset` SHOULD NOT expect `appliesTo` to skip rules.
```

**Surface B says** (entirety of `15-hardener-cli-public-surface.md`): the hardener CLI surface contains no mention of `appliesTo`, no project-type detection mechanism, no flag to declare project type, and no behavior contract describing whether/how `--preset` (or default "all installed") interacts with `appliesTo`.

**Why this matters**: A reader of either surface alone has no way to know what actually filters presets at audit time. Protocol-2 punts to "upstream", hardener punts (silently) by not mentioning the field. Phase-3 implementation will have to invent the wiring contract from scratch, and tests written from these surfaces cannot exercise the only documented consumer of `appliesTo`.

**Suggested fix**: Either (a) add a §"Preset selection" subsection to the hardener surface describing how `appliesTo` is read (or explicitly that it is ignored in MVP-0 and the field is purely metadata for now), or (b) drop the "consumed upstream by the hardener CLI" sentence from Protocol-2 and reframe `appliesTo` as plugin-author metadata with no documented runtime consumer in Phase 1.

---

### Finding 5 — Protocol-1 declares `CriticInfo.releaseDate` comes from `engine.getMeta()`, but `MinimalCriticEngineSurface.getMeta()` does not include `family`, while `CriticInfo` does

**Type**: shared-type mismatch (provenance contract incomplete)

**Surfaces involved**: `14-protocol-1` (internal, but it ripples into bundle surface 15)

**Surface A says** (`14-protocol-1-public-surface.md:68-75`):

```
  // Static metadata accessor; mirrors the EngineConfig fields.
  getMeta(): { engineKind: string; modelId: string; releaseDate: string };
}
```

```
**`CriticInfo` provenance**: `CriticInfo.engineKind`, `modelId`, and `releaseDate` come from `engine.getMeta()` (the contract above). The fields mirror the `EngineConfig` passed at engine construction time; engines do NOT query their backend for these strings.
```

**Surface A also says** (`14-protocol-1-public-surface.md:27-32`):

```
export interface CriticInfo {
  engineKind:  string;
  modelId:     string;
  releaseDate: string;
  family:      string;     // see family taxonomy below
}
```

**Why this matters**: `CriticInfo.family` has no provenance clause. `getMeta()` does not return it, and the surface does not say P1 derives it via `engineFamily(EngineConfig)` for each call. A mock engine that implements only `MinimalCriticEngineSurface` (as instructed at line 73 — "mocks only need to implement these three members") cannot supply `family`, so `VerdictedFinding.critic.family` is undefined. This silently propagates into `bundle.findings[i].critic.family` (hardener-side, surface 15).

**Suggested fix**: Either extend `getMeta()` to return `family` as well, or add an explicit provenance line: "P1 derives `CriticInfo.family` by calling `engineFamily(policy.critic)` once per `reviewFinding` / `reviewBatch` invocation; engines do NOT supply it."

---

### Finding 6 — Hardener CLI declares no log event for the `--key` redaction stderr note, while Protocol-2/Protocol-1 are silent on key handling

**Type**: cross-track causality (security claim asserted, observable contract incomplete)

**Surfaces involved**: `15-hardener-cli` (primarily); silent neighbors `13-protocol-2`, `14-protocol-1`

**Surface says** (`15-hardener-cli-public-surface.md:122-127`):

```
1. Each occurrence of `--key <provider>=<value>` in `process.argv` is overwritten in-place to `--key <provider>=[REDACTED]`. The mutation happens before any other code reads `process.argv`.
2. Stderr receives one note line: `note: --key value redacted from process listing. ...`
3. Engine configs containing keys MUST NOT be logged with keys present — the CLI's engine-config builder strips `apiKey` / `key` fields before passing config objects to `logger.log(...)`. (Note: the log module itself does not redact; the CLI is responsible.)
```

**Why this matters**: Behavior B-9-1 (`zerou audit --key openai=sk-secret-test` produces ZERO occurrences of `sk-secret-test` in log files) is asserted as a hard contract, but the CLI's event table (`cli.*` events, 15:320-344) has no `cli.config.key-redacted` event, no documented log of which providers had a key supplied via flag vs env vs config. More importantly, the assertion "engine-config builder strips `apiKey` / `key` fields before passing config objects to `logger.log(...)`" is a CLI-internal claim with no test hook on Protocol-1 / Protocol-2 sides. A future patch that adds a `cli.policy { workerConfig: {…apiKey…} }` field (e.g. for diagnostics) would not be caught by any of these three surfaces.

**Suggested fix**: Add a contract line in Protocol-1's surface forbidding `apiKey`/`key` fields in any `critic.*` event payload (or in `EngineConfig`-shaped payloads anywhere), so the security invariant is enforced at the protocol boundary, not just by CLI convention.

---

### Finding 7 — `bundle.audit.presets[]` shape conflicts with `LoadedPreset` and the lookup-chain audit story drops `shadowedBy`

**Type**: naming drift / cross-track causality

**Surfaces involved**: `13-protocol-2`, `15-hardener-cli`

**Surface A says** (`13-protocol-2-public-surface.md:79-84`):

```
export interface LoadedPreset {
  manifest:        PresetManifest;
  source:          LookupSource;
  resolvedPath:    string;
  shadowedBy:      LookupSource[];     // empty if no shadowing
}
```

**Surface B says** (`15-hardener-cli-public-surface.md:141-147`):

```
    presets:     Array<{
      id:           string;
      version:      number;
      source:       'plugin' | 'project' | 'builtin';
      resolvedPath: string;
    }>;
```

**Why this matters**: The hardener bundle drops `shadowedBy` even though Protocol-2 prominently emits `preset.load.shadowed` events and the hardener surface itself documents `cli.preset.shadow-warn` and a stdout warn line for shadowed presets. A later reader of the EvidenceBundle therefore cannot reconstruct which lookups were shadowed at audit time — the audit-reproducibility contract (CONTEXT Q5: "auditable reproducibility") is incomplete. Reproducing an audit on a different machine where the shadow chain differs would silently change behavior with no record in the bundle.

**Suggested fix**: Add `shadowedBy: ('plugin' | 'project' | 'builtin')[]` to `bundle.audit.presets[]`, mirroring `LoadedPreset`. Empty array when nothing was shadowed.

---

### Finding 8 — `PresetManifest.body` and `PresetRule.source` are advertised on the manifest shape but the hardener bundle and stdout report contracts never reference them

**Type**: cross-track causality (advertised consumer missing)

**Surfaces involved**: `13-protocol-2`, `15-hardener-cli`

**Surface A says** (`13-protocol-2-public-surface.md:182`):

```
The markdown body after the `---` divider is captured into `PresetManifest.body` verbatim. It is used by hardener CLI's human report; it has no execution semantics.
```

**Surface B says** (`15-hardener-cli-public-surface.md:193-194`):

```
## Stdout report

Six sections in fixed order: header, preset list (with shadow warnings), findings (grouped by severity then preset, colorized unless `--no-color`), summary, apply summary (if `--apply` used), exit line.
```

…with no mention of preset `body` rendering, no behavior contract asserting it appears in stdout, and no EvidenceBundle field carrying it.

**Why this matters**: Protocol-2 claims a downstream consumer (the hardener CLI human report) reads `manifest.body`. If a Phase-3 implementer trims `body` for memory reasons (it can be large markdown), no surface-level test will catch the regression because the hardener surface never asserts the consumption.

**Suggested fix**: Either (a) add a behavior contract to the hardener surface ("each preset that produced ≥1 finding has its `manifest.body` rendered as a remediation section in the stdout report"), or (b) remove the claim from Protocol-2 §"Manifest schema (v0.2 frontmatter)" so the field's purpose is left genuinely unspecified rather than falsely cross-referenced.

---

### Finding 9 — `cli.policy` event and Protocol-1 `critic.policy-selected` event have identical schemas but separate emission contracts, with no statement of whether both fire per audit

**Type**: log-event near-collision (duplicate event, unclear ordering)

**Surfaces involved**: `14-protocol-1`, `15-hardener-cli`

**Surface A says** (`14-protocol-1-public-surface.md:286`):

```
| `critic.policy-selected` | `info` | `workerFamily`, `criticFamily`, `crossFamily: boolean`, `reason: string` |
```

**Surface B says** (`15-hardener-cli-public-surface.md:334`):

```
| `cli.policy` | `info` | `workerFamily`, `criticFamily`, `crossFamily: boolean`, `reason: string` |
```

**Why this matters**: Identical payload schema, two different event names, almost certainly fired during the same audit invocation (CLI selects a policy; then P1's `pickCriticEngine` re-emits during `reviewBatch`). A log consumer summarizing audits will see one logical fact under two names and either double-count or pick arbitrarily. Neither surface acknowledges the other's event.

**Suggested fix**: Either (a) hardener calls `pickCriticEngine` itself, captures the resulting `CriticPolicy`, and emits only `cli.policy` — and Protocol-1 only emits `critic.policy-selected` when invoked *without* the policy pre-computed (i.e. as a library entry point). Document this in both surfaces. Or (b) drop `cli.policy` and have hardener rely on Protocol-1's `critic.policy-selected` (consistent with finding 3's resolution direction).

---

### Finding 10 — `MinimalCriticEngineSurface.lastCallCostUsd()` is required for cost-cap accounting, but no surface specifies whether it must be sync-safe in the concurrent path (`reviewBatch`)

**Type**: contract gap (not strictly an inconsistency, but a cross-surface hole) — flagged but lower confidence

**Surfaces involved**: `14-protocol-1`

**Surface says** (`14-protocol-1-public-surface.md:66-67`):

```
  // Per-call cost reporting (used by reviewBatch cost-cap accounting).
  // Engines that cannot report cost return null.
  lastCallCostUsd(): number | null;
```

…and (`14-protocol-1-public-surface.md:234-238`):

```
- Cost is evaluated AFTER each critic call completes (post-call accounting).
- The throttle fires (concurrency drops to 1) when `costSoFar >= costCap` (inclusive `>=` comparison).
```

**Why this matters**: Under `concurrency: 5`, the second-through-fifth in-flight calls may complete in interleaved order and each will read `lastCallCostUsd()` on the same shared engine instance (per "Engine instance pooling" at line 185, "each `pickCriticEngine` call returns a `CriticPolicy` whose `criticEngine` is a FRESH engine instance" — so it's the same instance for all calls in one batch). A naive engine implementation where `lastCallCostUsd()` mutates / reads instance state without synchronization will return the wrong call's cost. The Protocol-1 surface should specify the contract: "P1 reads `lastCallCostUsd()` synchronously immediately after each `call()` resolves, before yielding to the event loop, so engines are not required to serialize their cost reporting."

**Suggested fix**: Add one sentence to the §"Critic engine call contract" pinning the call/read ordering relative to the event loop.

---

## Summary

| Type | Count |
|---|---|
| Shared-type mismatch | 2 (Findings 1, 5) |
| Naming drift | 2 (Findings 2, 7) |
| Contract contradiction | 1 (Finding 3) |
| Log-event collision | 1 (Finding 9) |
| Error-code overlap | 0 |
| Logger convention | (counted under contract contradiction — Finding 3) |
| Version | 0 |
| Env var | 0 |
| Behavior-ID | 0 |
| Cross-track causality | 3 (Findings 4, 6, 8) |
| Contract gap (other) | 1 (Finding 10) |

**Total inconsistencies**: 10

Highest-leverage findings to fix first:

1. **Finding 1** (`call` vs `callJson`) — blocks all Protocol-2 llm-judgment test writing.
2. **Finding 3** (logger track inheritance vs `track='critic'` header) — every Phase-3 log assertion has to pick a side or fail.
3. **Finding 2** (`kind` vs `engineKind` in same bundle) — locks in a permanent papercut in the EvidenceBundle JSON shape; cheap to fix now, expensive after first external consumer ships.

Files I read: D:\lll\d2p\docs\details\12-log-module-public-surface.md, D:\lll\d2p\docs\details\13-protocol-2-public-surface.md, D:\lll\d2p\docs\details\14-protocol-1-public-surface.md, D:\lll\d2p\docs\details\15-hardener-cli-public-surface.md, D:\lll\d2p\CONTEXT.md
