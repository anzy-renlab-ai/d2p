# Phase 11.2 — HTML Report + `zerou review` + Run Archive

> Users were reading `.zerou/logs/<ulid>.jsonl` to find out what ZeroU did.
> Per `docs/reviews/2026-05-27-presentation-layer.md`, ship a self-contained
> HTML report with side-by-side diff, module filter chips, sticky merge/drop
> buttons. Zero npm deps. Plus `zerou review` to open it in a browser.

---

## Goal

The Phase 10 markdown report (`.zerou/enhance-report.md`) was greppable and
PR-paste-friendly, but a wall of unified diff buried what mattered. The
chosen design (Option 1 from the presentation-layer review): one HTML file,
inlined CSS + vanilla JS, side-by-side diff viewer, archived per run.

User flow after this phase:

```
zerou enhance ./my-app
  → writes .zerou/runs/<YYYYMMDD-HHMMSS>/{enhance-report.html, .md}
  → and stable copies at .zerou/enhance-report.{html, md}
  → compact 10-line stdout summary (was 30-line stream)

zerou review                       # opens the latest report
zerou review --run <ts>            # opens a specific archived run
zerou review --print               # prints file:// URI; no browser open
```

The markdown report stays the canonical text artifact. The HTML is the
human surface.

## Non-Goals

- ❌ No localhost server (deferred to Phase 12)
- ❌ No npm deps; pure vanilla TS that templates one HTML file
- ❌ No TUI (`ink` / `blessed`) — those vanish after the run
- ❌ No VSCode extension; no full SPA
- ❌ No diff2html fallback yet — hand-rolled renderer fits the LOC budget

## Architecture

```
cli/src/enhance/html-report.ts        templater (~400 LOC)
cli/src/enhance/html-diff.ts          unified-diff → paired rows
cli/src/enhance/html-assets.ts        CSS + JS strings (inlined)

cli/src/enhance.ts                    writes both .md + .html, archives runs
cli/src/review.ts                     new entry (open file in browser)
cli/src/zerou-cli.ts                  routes `zerou review`
```

Archive layout (per-run, never overwritten):

```
.zerou/
├── enhance-report.html             ← stable copy of latest
├── enhance-report.md               ← stable copy of latest
└── runs/
    └── 20260527-171253/
        ├── enhance-report.html
        └── enhance-report.md
```

## Module Contracts

**`enhance/html-report.ts`**

```typescript
export class HtmlReportWriter {
  constructor(opts: { reportPath: string; logger: TrackLogger });
  setFiles(files: ChangedFile[]): void;
  setModules(modules: ModuleResult[]): void;
  setVerify(result: VerifyResult): void;
  setRunMeta(meta: { project: string; durationMs: number; runTs: string }): void;
  finalize(): Promise<void>;
}
```

- Output is a single HTML file. CSS + JS are inlined from `html-assets.ts`.
- Live append: while running, the writer emits an HTML containing
  `<meta http-equiv=refresh content=2>` wrapped in
  `<!--ZEROU:REFRESH_START--> … <!--ZEROU:REFRESH_END-->` markers.
  `finalize()` strips them.
- Module filter chips (📝 Logging / 🐛 Bug fix / 🏥 Health / 🚨 Sentry /
  🔧 .env) toggle visibility via JS delegation; URL hash captures state.
- Path traversal: file paths are HTML-escaped before any DOM injection.
- Prefers-color-scheme aware (light + dark CSS).

**`enhance/html-diff.ts`**

```typescript
export interface PairedDiffRow {
  beforeLine: number | null;
  afterLine: number | null;
  beforeText: string | null;
  afterText: string | null;
  marker: 'add' | 'del' | 'ctx' | 'hdr';
}

export function parseUnifiedDiff(diff: string): PairedDiffRow[];
```

- Pure function over unified diff text; no fs.
- Stable line numbers across hunks; binary diff blocks emit a single `hdr` row.

**`review.ts`**

```typescript
export interface ReviewCliOpts {
  argv: string[];
  opener?: (urlOrPath: string) => Promise<{ ok: boolean; error?: string }>;
  // test seams omitted for brevity
}

export async function runReview(opts: ReviewCliOpts): Promise<number>;
```

- Default opener: `cmd /c start` (Win), `open` (macOS), `xdg-open` (Linux).
- `--print` outputs the resolved `file://` URI to stdout.
- Resolution order: `--run <ts>` → `--latest` → stable copy → newest archive.

## Acceptance Checklist

1. `zerou enhance` emits both stable + per-run HTML/MD copies.
2. HTML is self-contained (no network, no missing assets) and opens offline.
3. `zerou review --print` resolves the expected report path.
4. Not doing: localhost server, diff2html dep, TUI.
5. Done when `zerou review` opens the report in the default browser AND
   stdout compact summary replaces the 30-line stream.

## How To Verify

```bash
cd D:/lll/d2p/cli
npx vitest run src/enhance/html-report.test.ts \
                src/enhance/html-diff.test.ts \
                src/review.test.ts

# E2E:
node cli/bin/zerou.mjs enhance /tmp/phase5-demo \
  --config /tmp/zerou-minimax-cfg.json --no-color
ls /tmp/phase5-demo/.zerou/runs/                # one timestamped dir
node cli/bin/zerou.mjs review /tmp/phase5-demo --print
```

## Implementation

- Worker dispatch: single sonnet worker (writer + diff + assets co-evolve).
- New files: `html-report.ts`, `html-diff.ts`, `html-assets.ts`, `review.ts`,
  plus `.test.ts` siblings.
- Compact stdout (replaces previous 30-line stream): module → file count →
  duration → verdict glyph, one line per module.
- Archive dir creation: `.zerou/runs/<ts>/` mkdir -p; never collide with
  existing.

## Status

```
Shipped: 428c526
Tests: +22 html-report, +14 html-diff, +11 review; 0 regression
Dogfood: phase5-demo + agent-game-platform — both browse-able offline
```
