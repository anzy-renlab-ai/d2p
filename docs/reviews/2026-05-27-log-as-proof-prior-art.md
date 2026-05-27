# Log Stream as Completeness Proof — Industry Prior Art

> Research target: when ZeroU finishes running on a demo, the `.jsonl` files it
> produced should themselves be the proof of coverage. A third party should be
> able to `cat`, `jq`, `sort -u | wc -l`, and conclude "every branch hit" — no
> UI, no separate report, no screenshot. This document surveys how the
> observability industry already makes log streams act as self-contained
> evidence artifacts, and proposes the schema ZeroU should adopt.

## TL;DR

- Borrow Honeycomb's **wide event** ("one fat JSON per unit of work, 200+
  dimensions, no separate metrics/logs/traces") as the top-level shape.
- Borrow **OpenTelemetry's `code.*` semantic conventions** (`code.function.name`,
  `code.file.path`, `code.line.number`, `code.column.number`) so the field
  names are not invented and tooling can already parse them.
- Borrow OpenTelemetry **LogRecord correlation**: every line carries
  `trace_id` + `span_id` so `grep trace_id=X` reconstructs an execution path.
- Add a ZeroU-specific **`branch.taken`** event — a wide event with a
  hierarchical `branch_id` (`file:fn@line:kind#index`) — so
  `jq -r 'select(.event=="branch.taken") | .branch_id' *.jsonl | sort -u | wc -l`
  is the coverage number.
- Add **content hash + sequence number** per line (lessons from
  audit-trail / OpenTelemetry-immutable-pipeline literature) so the file is
  tamper-evident without a separate manifest.
- Result: ZeroU logs become a citable, OpenTelemetry-compatible artifact —
  not a proprietary blob.

## 1. Honeycomb wide events

Charity Majors' core claim: emit **one arbitrarily wide structured event per
unit of work**, instead of scattering N log lines and recomputing metrics
later. "Maturely instrumented datasets are often 200-500 dimensions wide,"
and "adding more dimensions to your event is effectively free." Crucially,
"aggregation is a one-way trip" — once you've turned events into
counters, you've destroyed your ability to ask the next question.

A canonical wide event from Honeycomb / "All you need is Wide Events":

```json
{
  "Timestamp": "1707951423",
  "AdId": "542508c92f6f47c2916691d6e8551279",
  "UserCountry": "US",
  "Placement": "mobile_feed",
  "CampaignType": "direct_ads",
  "UserOS": "Android",
  "OSVersion": "14",
  "AppVersion": "798de3c28b074df9a24a479ce98302b6",
  "SpanId": "...", "TraceId": "...", "ParentSpanId": "..."
}
```

**Why this works as proof**: every fact about that request is in one line.
You don't have to cross-reference. You can write a SQL/jq one-liner over a
flat file and the answer is right. The file *is* the dataset.

ZeroU translation: each `branch.taken` event should be a wide event carrying
trace IDs, code identity (file/fn/line), the decision taken, the args hash,
the runtime context — not a thin "I was here" ping that requires the
report-generator to be trusted.

## 2. OpenTelemetry — three pillars unified

OTel's data model says: **logs, traces, and metrics share `trace_id` /
`span_id`**. A `LogRecord` carries the same `TraceId` (32-char lowercase hex,
W3C trace context) and `SpanId` (16-char lowercase hex) as the trace span
that was active when it was emitted. SDKs inject these automatically: "when
you emit a log while a span is active, the OpenTelemetry SDK automatically
attaches the trace ID and span ID to the log record".

This is the key move for ZeroU's "log file as proof" property. Given a log
file:

```sh
jq -c 'select(.trace_id == "01KSMFJK29GXBFMNSJ16JFJ69E")' run.jsonl \
  | jq -r '.event'
```

reconstructs the **full execution path** for one run — entry, every branch
taken, every error caught, exit. No backend required.

ZeroU already has `trace` and `track` fields in its `LogEntry`
(`cli/src/log/track-logger.ts`). Renaming `trace` → `trace_id` and adding
a `span_id` field would make the file directly OTel-compatible — usable by
Loki, Tempo, Grafana, Datadog, SigNoz without translation.

The official OTel LogRecord canonical fields are:

| Field | Purpose |
|---|---|
| `Timestamp` / `ObservedTimestamp` | ns since epoch |
| `TraceId` (32 hex) | request correlation |
| `SpanId` (16 hex) | span correlation |
| `SeverityNumber` (1-24) | mapped to TRACE/DEBUG/INFO/WARN/ERROR/FATAL |
| `Body` | message, free-form or structured |
| `Attributes` | per-event key-values |
| `Resource` | per-process attributes (service.name, version, …) |

## 3. Semantic conventions for code (`code.*` attributes)

OTel's `code.*` registry — stable as of semconv 1.33.0 — gives ZeroU
ready-made names for "where in the source code did this happen":

| Attribute | Type | What |
|---|---|---|
| `code.function.name` | string | Fully qualified, no args. `com.example.MyHttpService.serveRequest`, `getServerSideProps`, `fopen` |
| `code.file.path` | string | Source file path |
| `code.line.number` | int | Line number representative of the operation |
| `code.column.number` | int | Column number |
| `code.stacktrace` | string | Natural-language stack trace for the runtime |

Deprecated alternatives — `code.function`, `code.namespace`, `code.lineno`,
`code.filepath`, `code.column` — were folded into the names above
in the stability migration.

**Why this matters**: ZeroU's `BranchNode` already carries
`{ file, name (function), line, kind, id }`. Mapping those onto the OTel
names lets any consumer that already speaks OTel (Honeycomb, Datadog, Tempo,
SigNoz, Grafana, Sentry) display ZeroU's branch logs without custom
ingestion code.

## 4. Coverage-as-log: does anyone do this today?

Yes, but only in academia — and they're solving the **inverse** problem.

- **LogCoCo** (ICSE / ASE 2018, P. C. Rigby et al.) and the follow-up
  **Log2Cov** (TSE 2024, Uwaterloo) estimate **method / statement / branch
  coverage from execution logs alone** by static-matching log statements
  against AST branches. Their pain point: "uncertainty due to the lack of
  logging statements in conditional branches" — programs simply don't log
  inside every `if`.
- Stryker / PIT mutation testing emits a survived-mutants report, not a
  log stream, but the philosophy is parallel: "the suite is only as good
  as the mutants it kills" maps cleanly to "the suite is only as good as
  the branches its logs witness."

**Nobody in production tooling treats the log file as the canonical
coverage artifact today.** c8 / istanbul / nyc emit a separate
`coverage-final.json`; mutation tools emit `mutation-report.json`. The
log file is always secondary evidence. ZeroU's move is to make
`logs/agent/<date>/<ulid>.jsonl` *primary* — a citable, OTel-shaped
artifact whose line count *is* the coverage measurement.

This positions ZeroU as the "log-coverage" rather than "test-coverage"
viewpoint: instrumentation density is the product, the JSONL file is the
deliverable.

## 5. Audit-grade properties

From the immutable-audit-log literature (financial-grade compliance, SOX
non-repudiation, OpenTelemetry audit pipelines):

| Property | Essential? | How |
|---|---|---|
| Append-only | yes | open file `O_APPEND`; never `O_TRUNC`; rotate on size/date |
| Monotonic timestamp | yes | nanoseconds since epoch; node `process.hrtime.bigint()` for sub-ms |
| Sequence number per line | yes | `seq: 0, 1, 2, …` — detects truncation, reordering |
| Content hash | recommended | SHA-256 of canonical-JSON of prior line + current body; chains the file like a hash chain |
| External signing | overkill for ZeroU | needed for SOX, not for "did we cover branch X" |
| Object Lock / WORM | overkill for ZeroU | needed for compliance, not for proof of coverage |

ZeroU's logs need to be **tamper-evident enough that a reviewer
believes the count**, not **legally binding**. The minimum-viable
audit-grade upgrade is: add `seq` (sequence number) and
`prev_hash` / `hash` fields. Then any consumer can run

```sh
jq -r '[.seq, .hash, .prev_hash] | @tsv' run.jsonl \
  | awk '{ if ($3 != prev_hash) print "BREAK at "$1; prev_hash=$2 }'
```

to verify the chain. This is the same construction that
oneuptime's "OpenTelemetry immutable audit log pipeline" uses
(SHA-256 of canonical event with sorted keys).

## 6. Recommended ZeroU log schema (the proof-shape)

Synthesizing wide events + OTel correlation + `code.*` semconv + chain
hash, a single `branch.taken` line should look like:

```json
{
  "ts": 1779877629053000000,
  "seq": 142,
  "level": "info",
  "severity_number": 9,

  "trace_id": "01KSMFJK29GXBFMNSJ16JFJ69E",
  "span_id": "f8a3c1b2d4e50f97",
  "parent_span_id": "3b91e7d52c1408af",

  "event": "branch.taken",

  "code.file.path": "src/lib/auth.ts",
  "code.function.name": "validateLogin",
  "code.line.number": 9,
  "code.column.number": 5,

  "branch": {
    "id": "src/lib/auth.ts:validateLogin@7:if-line9-true#0",
    "kind": "if-true",
    "label": "!email TRUE → 400",
    "decision": "reject",
    "outcome": "early-return",
    "args_hash": "sha256:7fa3…",
    "depth": 2,
    "parent_branch_id": "src/lib/auth.ts:validateLogin@7:entry"
  },

  "resource": {
    "service.name": "meme-weather",
    "service.version": "0.4.1",
    "zerou.run_id": "01KSMFJK29GXBFMNSJ16JFJ69E",
    "zerou.demo_path": "D:/lll/meme-weather-zerou-test"
  },

  "prev_hash": "sha256:01a9…",
  "hash": "sha256:b27e…"
}
```

Schema design notes:

1. **`branch.id` is a hierarchical, deterministic string** —
   `file:fn@declLine:kind-line-direction#nthInScope`. This is the **proof
   key**. Run AST once, enumerate `branch.id`s, that's the denominator. The
   numerator is `jq -r '.branch.id' *.jsonl | sort -u | wc -l`.
2. **`code.*` keys are OTel-stable**, so any OTel collector reads them.
3. **`trace_id` / `span_id`** put ZeroU on the same correlation rail as
   the rest of the user's stack — they can see ZeroU's branch trace
   stitched alongside their own request traces in Tempo / Datadog APM.
4. **`args_hash`** is a stable hash of stringified, redacted arguments so
   "same branch hit 17 times with the same input" collapses correctly
   when needed, but high-cardinality input variety is preserved when not.
5. **`severity_number`** maps ZeroU's 4 levels to OTel's 24-level scale
   (debug=5, info=9, warn=13, error=17) — already in OTel's data model.
6. **`prev_hash` / `hash`** chain — minimum audit-grade.

ZeroU's existing `LogEntry` (`ts, level, track, trace, scope, event, …`)
maps cleanly: `trace` → `trace_id`, `scope` becomes part of
`code.function.name`, `event` stays, the rest goes into a `branch` or
`code.*` sub-object.

## 7. The "open the log file → count → done" workflow

Given a finished ZeroU run at
`.zerou/logs/agent/2026-05-27/01KSMFJK29GXBFMNSJ16JFJ69E.jsonl` and an AST
enumeration of expected branches at `.zerou/branch-coverage.json`:

```sh
# 1. Count unique branches witnessed in the log
WITNESSED=$(jq -r 'select(.event=="branch.taken") | .branch.id' \
                .zerou/logs/agent/2026-05-27/*.jsonl \
            | sort -u | wc -l)

# 2. Count branches the AST said exist
EXPECTED=$(jq -r '.functions[].root | recurse(.children[]?) | .id' \
                .zerou/branch-coverage.json \
            | sort -u | wc -l)

# 3. Coverage
echo "scale=2; 100 * $WITNESSED / $EXPECTED" | bc
# → 100.00
```

That is the workflow. Three commands, all POSIX, no UI, no daemon, no
backend, no proprietary CLI. The numbers are reproducible from the file
alone — anyone with `jq` + `sort` + `wc` can replay it. That is what makes
the log file the *proof*.

For CI: run those three commands, fail the job if the ratio < 1.00 (or <
agreed threshold). The exit code from the bash script *is* the gate.

For audit: `sha256sum *.jsonl` + the chain-verification script in §5. If
the chain is intact and the count is 100, the proof is sound without
trusting any ZeroU code to summarize honestly.

## 8. Anti-patterns to avoid

- **Free-form `message` strings.** Sentry / Honeycomb / OTel all support
  free-form messages but warn: never use them as the join key. ZeroU's
  `branch.id` is structured; resist the urge to put "took the true arm"
  in `message` and call it done.
- **Per-line custom field names.** Inventing `decision_path` /
  `branch_taken` / `arm` in different places destroys queryability.
  Pick the names from OTel semconv where they exist; pick ZeroU-canonical
  names (`branch.id`, `branch.kind`) where they don't, and document them
  once.
- **Logging only on entry, not on every arm.** This is the LogCoCo
  "may-coverage" trap — without a log inside both arms of every `if`, the
  log file under-counts. Bootstrap-template injection
  (`cli/src/enhance/bootstrap-templates.ts`) and codemod-time
  `logBranch(…)` insertion must close this gap *together*.
- **Mixing track/scope/event hierarchies inconsistently.** Today
  `event: 'agent.project-detection.heuristic-fallback'` mixes scope into
  the event name. Pick one: either `scope` is the canonical hierarchy
  field and `event` is the leaf, or events are fully dotted and there is
  no scope. (OTel + Sentry both pick "category is dotted, event is
  short" — recommend that.)
- **Logging summaries instead of raw events.** Charity's "aggregation is
  a one-way trip" — the moment ZeroU writes `branches_covered: 17` as
  one line instead of 17 `branch.taken` lines, the proof property is
  gone. Summary lines may exist alongside, but the raw events must
  always be the source of truth.
- **Forgetting `trace_id` on user-side logs.** The pino bootstrap in
  `bootstrap-templates.ts` populates `correlationId` from
  `AsyncLocalStorage`. Renaming that to `trace_id` (or also emitting
  `trace_id` as an alias) is a one-line change that puts user-emitted
  logs on the same rail as ZeroU's agent logs — then a single
  `jq 'select(.trace_id==X)'` reconstructs the full
  agent+user-runtime story.
- **Skipping `seq`.** Without sequence numbers, log truncation is
  silent. With them, `awk 'BEGIN{n=0}{if($1!=n)print "GAP "n;n=$1+1}'`
  detects loss.

## 9. Citations

- Honeycomb / Charity Majors — Live Your Best Life With Structured Events:
  <https://charity.wtf/2022/08/15/live-your-best-life-with-structured-events/>
- "All You Need Is Wide Events, Not Metrics/Logs/Traces" (I. Burmistrov):
  <https://isburmistrov.substack.com/p/all-you-need-is-wide-events-not-metrics>
- Honeycomb — Observability Engineering primer:
  <https://www.honeycomb.io/resources/getting-started/what-is-observability-engineering>
- OpenTelemetry Logs Data Model:
  <https://opentelemetry.io/docs/specs/otel/logs/data-model/>
- OpenTelemetry Logging spec:
  <https://opentelemetry.io/docs/specs/otel/logs/>
- OpenTelemetry Semantic Conventions — code attributes registry:
  <https://opentelemetry.io/docs/specs/semconv/registry/attributes/code/>
- OpenTelemetry semconv code-attrs stability migration guide:
  <https://opentelemetry.io/docs/specs/semconv/non-normative/code-attrs-migration/>
- OpenTelemetry log correlation (.NET example):
  <https://opentelemetry.io/docs/languages/dotnet/logs/correlation/>
- Sentry Breadcrumbs Interface (developer docs):
  <https://develop.sentry.dev/sdk/data-model/event-payloads/breadcrumbs/>
- Datadog — Correlate Logs and Traces:
  <https://docs.datadoghq.com/tracing/other_telemetry/connect_logs_and_traces/>
- Datadog — Unified Service Tagging (env / service / version):
  <https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/>
- Datadog — Default Standard Attributes:
  <https://docs.datadoghq.com/standard-attributes/>
- LogCoCo — automated code coverage estimation via execution logs (ASE
  2018): <https://dl.acm.org/doi/10.1145/3238147.3238214>
- Log2Cov — mitigating uncertainty in log-based coverage (TSE 2024):
  <https://rebels.cs.uwaterloo.ca/papers/tse2024_xu.pdf>
- OneUptime — Building an immutable audit log pipeline using
  OpenTelemetry:
  <https://oneuptime.com/blog/post/2026-02-06-immutable-audit-log-pipeline-otel/view>
- Stryker Mutator — what is mutation testing:
  <https://stryker-mutator.io/docs/>
- W3C Trace Context: <https://www.w3.org/TR/trace-context/>
