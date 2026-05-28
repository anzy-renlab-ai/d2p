# Phase 11.4 — Dense Table HTML Report

> Replace the Phase 11.2 narrative HTML ("wall of code, all diffs expanded
> by default") with a dense, table-driven view: filter chips + sortable
> rows + collapse-by-default + hotkeys. Same single-file, zero-dep
> deliverable.

---

## Goal

After Phase 11.2 the HTML report shipped, but on real projects it was a
storybook — diffs all expanded by default, no at-a-glance overview, no
quick way to scan "what changed where". User feedback boiled down to: I
want a spreadsheet of changes, not an essay.

Phase 11.4 keeps the same writer entry point but rebuilds the body around
two tables (FILES + FINDINGS) plus a VERIFY chip-grid. Still single HTML
file, still zero deps.

## Non-Goals

- ❌ No npm dep additions (still vanilla TS + inlined CSS/JS)
- ❌ No new pages or multi-file output — one HTML, period
- ❌ No real-time updates yet (Phase 11.2 meta-refresh stays as-is)
- ❌ No syntax highlighting in diffs (highlighting added in Phase 12 React UI)
- ❌ No persistence beyond URL hash for filter state

## Architecture

Same module layout as Phase 11.2; the work is in the assets and writer:

```
cli/src/enhance/html-report.ts   +183 LOC (setFindings, setLogSiteCount,
                                 buildFindingRows, markers, render path)
cli/src/enhance/html-assets.ts   +208 LOC (table CSS, badges, verify-grid,
                                 hotkey overlay JS, URL-hash state)
cli/src/enhance/html-report.test.ts  +290 LOC (43 tests, was 22)
cli/src/enhance.ts               +3 LOC (reads test-results.json, passes
                                 to writer)
```

Visual layout:

```
┌──────────────────────────────────────────────────────────────────┐
│  Sticky header: project / duration / verify status               │
├──────────────────────────────────────────────────────────────────┤
│  Summary strip: N files · +X -Y · M log sites · K findings       │
│  Filter bar: [📝 Log] [🐛 Bug] [🏥 Health] [🚨 Sentry] [🔧 .env]│
│              severity: [P1 ▾] [text filter] (URL-hash state)     │
├──────────────────────────────────────────────────────────────────┤
│  FILES table — <details><summary>, collapsed by default          │
│    ✅ │ NEW │ +12 -3 │ path/to/file.ts          │ 📝 🐛           │
├──────────────────────────────────────────────────────────────────┤
│  FINDINGS table — 38 P1/P2/P3 sorted                             │
│    ● │ P1 │ db-injection │ endpoint:line       │ given/when/then │
│      └─ click expands spec + reject reason                       │
├──────────────────────────────────────────────────────────────────┤
│  VERIFY chip-grid — per-step status + duration                   │
├──────────────────────────────────────────────────────────────────┤
│  Footer: [copy merge] [copy drop] [copy branch]                  │
└──────────────────────────────────────────────────────────────────┘

Hotkeys:   f = focus filter, e = expand all, c = collapse all, ? = help
```

## Module Contracts

**`enhance/html-report.ts` (new methods on `HtmlReportWriter`)**

```typescript
setFindings(findings: AuditFindingWithPatchState[]): void;
setLogSiteCount(count: number): void;
private buildFindingRows(findings: AuditFindingWithPatchState[]): string;
```

- `AuditFindingWithPatchState` extends `AuditFinding` with
  `patchState: 'patched' | 'rejected' | 'skipped'` and `rejectReason?: string`.
- Sort key for FINDINGS rows: severity (P1 < P2 < P3) → category → file:line.
- Row glyphs: `●` patched, `○` rejected, `·` skipped.

**`html-assets.ts`**

- New CSS classes: `.zr-table`, `.zr-row`, `.zr-badge`, `.zr-chip`,
  `.zr-verify-grid`, `.zr-hotkey-overlay`.
- New JS handlers: `keydown` for hotkeys; `hashchange` for filter state.
- URL hash format: `#m=log,bug&sev=p1&q=<encoded>`.

## Acceptance Checklist

1. Single HTML file, no npm deps added.
2. FILES + FINDINGS render as tables; rows collapsed by default.
3. URL-hash filter state survives page reload.
4. Not doing: real-time refresh, syntax highlighting, multi-file output.
5. Done when 271 enhance tests pass + visual smoke shows
   spreadsheet-like row density on `meme-weather` dogfood.

## How To Verify

```bash
cd D:/lll/d2p/cli
npx vitest run src/enhance/html-report.test.ts

# Visual smoke:
node cli/bin/zerou.mjs enhance /tmp/phase5-demo \
  --config /tmp/zerou-minimax-cfg.json --no-color
node cli/bin/zerou.mjs review /tmp/phase5-demo
# → browser opens; check FILES + FINDINGS tables render dense
```

## Implementation

- Worker dispatch: single sonnet worker (writer + assets + tests co-evolve).
- Markdown report unchanged.
- Refactor scope: write path rewritten, but module entry points (`new
  HtmlReportWriter`, `finalize()`) preserved so `enhance.ts` only changed
  +3 LOC.

## Status

```
Shipped: 46e1a8e
Tests: 22 → 43 html-report (+21); 271 enhance tests pass; 0 regression
Dogfood: meme-weather-zerou-test — 38 findings render as a scannable table
```
