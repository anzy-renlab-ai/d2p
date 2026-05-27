# Presentation Layer Design — Phase 11

> Author: Subagent-C · Date: 2026-05-27
> Status: PROPOSAL — no code yet, awaiting user sign-off
> Locked product axis: **"you see the diff before merging"** is the ZeroU differentiation. Whatever we build must reinforce that, not bury it under chrome.

---

## TL;DR

Ship a **single self-contained HTML report** (`./.zerou/enhance-report.html`) generated alongside the existing markdown — zero npm deps, ~600 LOC of vanilla TS that templates one HTML file with inlined CSS and a minimal vanilla-JS diff viewer. **Plus** a tiny live-tail TTY summary on stdout (5 colored lines while running, replacing the current 30-line stream). The HTML opens in any browser with a side-by-side diff view, sticky file tree, per-module filter chips, and a "merge / drop" copy-button cheat-sheet at the top. Backup: bolt **diff2html** (~120 KB, MIT, single-file CDN-style ESM) into the same template if we decide hand-rolling a side-by-side renderer is more LOC than it's worth.

The markdown report stays the canonical text artifact (machine-greppable, PR-paste-friendly). The HTML is the **human surface** for "what did ZeroU do to my repo?"

---

## What we currently emit

| Artifact | Location | Utility | Inutility |
|---|---|---|---|
| `enhance-report.md` | `<repo>/.zerou/enhance-report.md` | Greppable, full unified diff inline, GH-renders fine | Diffs are flat unified-text walls; no side-by-side; lockfiles balloon the file; you have to scroll past 200+ lines to find what matters; "files changed TOC" works but offers no preview |
| `audit-report.md` | `<repo>/.zerou/audit-report.md` | Progressive — tail-able while audit runs | Section-replacement model means readers re-scroll on every refresh; no live "currently working on X" cue |
| Structured event logs | `<repo>/.zerou/logs/<track>/<date>/<ulid>.jsonl` | Machine-perfect; supports replay/debug | Single run = 100s of lines of `{"ts":..., "event":...}` JSON — user explicitly says this is "too inefficient" to read |
| Terminal stdout | live during `zerou enhance` | Real-time progress glyphs | Ephemeral, scrolls away, becomes unfindable once the run completes; useful **only** if user is watching the terminal |
| Git worktree branch | `.worktrees/zerou-enhance-<ts>` | The actual review surface (`git diff main..HEAD`) | User has to `cd` into the worktree and remember the git command — no first-class UI |

**Gap**: between the `git diff` truth-source (hard to navigate) and the markdown (too flat) there is no **glance-able, scannable, in-place** view of "every change ZeroU made, grouped by module, side-by-side, opened in 2 seconds."

---

## Survey of presentation forms

| Form | Effort (LOC / days) | Extra deps | Real-time? | User benefit | Cross-platform |
|---|---|---|---|---|---|
| 1. Terminal TUI (`ink` / `blessed`) | ~800 LOC / 3-5d | `ink` (~3 MB tree) or `blessed` (~600 KB) | Yes — best at it | Pretty during the run, vanishes after | OK; Windows console quirks with `blessed` |
| 2. **Single-file HTML report** | ~600 LOC / 2-3d | none (vanilla HTML/CSS/JS, inlined) | No (final-only) — but ships during run as progressive HTML if we mirror `progressive-report.ts` | "Open in browser, see everything, side-by-side diff, click to expand" | Perfect — any OS, any browser |
| 3. Localhost HTTP server (`http.createServer` from stdlib) | ~900 LOC / 4-5d | none (Node stdlib only) | Yes — SSE stream to a tab | Live progress + post-mortem in one tab; closes when ZeroU exits unless daemonized | Perfect, but port collisions + firewall prompts on Windows |
| 4. VSCode webview extension | ~1500 LOC / 7-10d | VSCode extension toolchain | Yes | Deepest in-IDE | Requires extension install — friction kills adoption |
| 5. GH-PR-style SPA | ~3000+ LOC / 10-15d | inevitably a framework | Yes | Feature-rich | Massive scope creep for an inner-loop CLI tool |
| 6. Markdown + sidecar HTML viewer (mdbook-style) | ~1000 LOC / 4d | mdbook (Rust binary) or pandoc | No | Nice but needs an extra binary on user's machine | Adds a runtime dep |
| 7. Compact stdout summary | ~80 LOC / 0.5d | none | Yes (and only) | Punchy "10 lines + path" — solves the "scrolled away" complaint partially | Perfect |

**Eliminated quickly**:
- 4 (VSCode webview): one extra install command is a 50 % drop in adoption.
- 5 (GH-PR SPA): scope, dep bloat, identity mismatch — ZeroU is not a code-review platform.
- 6 (mdbook sidecar): an extra Rust binary on user's machine for what is essentially a 1-file static page.

**Survivors for deep eval**: 2 (HTML), 3 (localhost HTTP), and 7 (compact stdout) — combinable: 2 + 7, or 3 + 7.

---

## Reference points — what works in the wild

- **`gh pr view` / `gh pr diff`**: the gold standard is *not* the rendering — it's the affordance. One command, terminal-native, with a `--web` escape hatch that opens the same data in a browser. **Takeaway**: keep stdout punchy + give the user a one-step "open in browser" escape.
- **`tig` / `lazygit`**: TUI diff viewers. Beautiful, but Windows-flaky and require users to learn keybindings. ZeroU users are demo-builders, not git power users — **takeaway**: don't make them learn a TUI.
- **Sentry issue page**: groups events by issue, shows latest occurrence, has a sidebar of "what changed". The **issue-with-evidence** pattern is what we want for "ZeroU changed these files for these reasons" — **takeaway**: group diffs by *module reason* not just by file.
- **VSCode source-control diff**: side-by-side, syntax-highlighted, expand/collapse hunks. The killer feature is **inline blame + hover** — beyond our scope, but the side-by-side + collapsible hunks is the bar.
- **`diff2html`**: ~120 KB single-file ESM, MIT, mature (8k+ GitHub stars), takes unified-diff text in → renders side-by-side or inline HTML out. **Takeaway**: this is the off-the-shelf path if we don't want to hand-roll a renderer. Backup choice.
- **`delta`**: terminal-side syntax-highlighted diff. Requires `delta` on PATH. Not portable enough as a hard dep, but worth a `if delta exists, use it` hint in the next-steps cheatsheet.

---

## Detailed evaluation: top 3

### Option 1 (RECOMMENDED): Single-file HTML report + compact stdout

**What user sees** when `zerou enhance` finishes:

```
zerou enhance D:\lll\meme-weather-zerou-test
Worktree:  .worktrees\zerou-enhance-20260527-160917
Branch:    zerou-enhance-20260527-160917
Framework: next.js

▶ log-injection   119 sites → 5 files     2.3s  ✅
▶ bug-patcher     0 findings              0.0s  ➖
▶ health-gen      app/health/route.ts     0.4s  ✅
▶ sentry          4 files + 1 dep         5.1s  ✅
▶ env-completer   +1 var                  0.2s  ✅
▶ verify          install/tsc/test/build  3m51s ✅

12 files changed · +2 301 / −26
─────────────────────────────────────────
  📄  .zerou/enhance-report.md       (markdown)
  🌐  .zerou/enhance-report.html     ← open this in your browser
  🌿  branch: zerou-enhance-20260527-160917
─────────────────────────────────────────
Next: zerou review        # opens the html in default browser
      git merge --no-ff zerou-enhance-20260527-160917
```

ASCII mockup of the HTML page (single file, opens in browser by double-click):

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ZeroU Enhance · meme-weather-zerou-test                       4m 2s · ✅    │
│  branch zerou-enhance-20260527-160917   ⎘ copy   ⎘ copy merge command        │
├──────────────────────────────────────────────────────────────────────────────┤
│  [ All 12 ] [ Log-injection 5 ] [ Sentry 4 ] [ Health 1 ] [ Env 1 ] [ Lock]  │
├────────────────────┬─────────────────────────────────────────────────────────┤
│  FILES (12)        │  middleware.ts                          +30 / −0  (new) │
│  ─────────────     │  ────────────────────────────────────────────────────── │
│  ▸ .env.example    │   1 │                          │ 1 │ import { NextRes…│
│  ▸ app/health/...  │   2 │                          │ 2 │ import pino from…│
│  ▸ instrumentat... │   3 │                          │ 3 │                  │
│  ▸ lib/db/client   │   4 │                          │ 4 │ const log = pino…│
│  ▸ lib/db/seed.ts  │     │                          │   │                  │
│  ▾ middleware.ts ←│   5 │  (file does not exist)   │ 5 │ export function …│
│      +30 / −0     │   6 │                          │ 6 │   const start = …│
│      (added by    │   …                                                     │
│       log-inj)    │                                                         │
│  ▸ package.json    │  [ ▾ expand 12 hidden context lines ]                  │
│  ▸ pnpm-lock.yaml  │                                                         │
│   (lockfile —      │  Why ZeroU added this:                                 │
│    diff omitted)   │  Module A/B (log-injection) needed an HTTP boundary    │
│  ▸ sentry.client.. │  log site. Framework=next.js → middleware.ts is the    │
│  …                 │  canonical entrypoint per Next docs.                   │
└────────────────────┴─────────────────────────────────────────────────────────┘
```

Key UI affordances:

- **Sticky header** with branch name + two copy buttons (copy branch name, copy merge command) — solves "scroll back to find the command" today.
- **Module filter chips** at top — "I only care about the bug patches, hide the rest." This is the **Sentry-style group-by-reason** pattern.
- **Left rail** = file tree, sorted by module (so all log-injection files cluster), with `+N/−N` badges. Click = scroll-to.
- **Main pane** = side-by-side diff (line numbers, syntax-light via simple regex coloring; full Prism.js is overkill).
- **Per-file "Why ZeroU did this"** caption pulled straight from the log-planner decision branches (`enhance.log.planner.complete` already records `sitesByKind` + `framework` reasoning).
- **Lockfile diffs collapsed by default** (matches the existing `ALWAYS_OMIT_FILES` rule but UI-side).
- **Hunk expand/collapse** — start with default unified-diff hunks expanded, "expand 12 hidden context lines" for full file.

**Tech stack**:
- Vanilla TS module → emits one `.html` file with `<style>` and `<script type="module">` inlined.
- Diff parsing: reuse the existing `parseNameStatus` + per-file unified diff text already fetched by `defaultDiffFetcher` in `enhance/report.ts` — no new git calls.
- Side-by-side rendering: a ~150-LOC pure function that walks unified-diff hunks and assembles `{ leftLines: [], rightLines: [] }`.
- Syntax light: 30-line regex tokenizer (keywords, strings, comments) for the 5-6 languages we'll see (TS/JS/Python/Go/JSON/YAML). Acceptable AI-slop because nobody will scroll to find a missed keyword highlight; the *diff* is the signal.
- No build step — ship the file as a TS template literal in `cli/src/enhance/html-report.ts`.

**Effort**: ~2-3 dev-days. ~600 LOC. Zero deps. ~50 KB of generated HTML for a typical run (lockfile excluded).

**Pros**:
- Zero install impact — file generated alongside the markdown.
- Cross-platform — every OS has a browser.
- Fully offline — no CDN, no fonts, no analytics.
- Reinforces identity: "open the HTML, see every change, then merge or drop" — the diff IS the product.
- Greppable markdown stays intact for PR-paste / CI.

**Cons**:
- Not real-time (final-only) — the live-feed itch isn't fully scratched. **Mitigation**: the compact stdout block already shows live progress with one line per module; that handles the "I want to watch it work" need.
- Hand-rolling side-by-side rendering is ~150 LOC of state-machine code that has 3-5 edge cases (renames, binary files, trailing-newline). **Mitigation**: backup option (2b) is to inline `diff2html`'s standalone JS bundle.

---

### Option 2: Localhost HTTP server with SSE live progress

**What user sees**: ZeroU prints `http://localhost:7777` at startup, user opens the tab, sees a live-updating page during the run, same artifact stays after exit.

**Tech stack**:
- Node stdlib `http.createServer` (zero deps) + SSE (Server-Sent Events) over a long-lived `text/event-stream` response.
- Tail-readers attach to the JSONL log file via `fs.watch` and stream new events as SSE.
- Same HTML template as Option 1, but with a `<script>` that subscribes to `/events` and patches the DOM as new events arrive.

**Effort**: ~4-5 dev-days. ~900 LOC. Zero deps.

**Pros**:
- Real-time. Watching ZeroU work is genuinely satisfying — exactly what user asked for.
- Same artifact survives after exit (server keeps running on demand, or serializes to HTML on shutdown).

**Cons**:
- **Port lifecycle is a real pain** on Windows: firewall prompt on first run, port collisions if user runs ZeroU twice, "did the server shut down cleanly?" questions.
- Adds a server process to manage (signal handling, graceful shutdown, "is it still listening?").
- The "open in browser" step is the same friction as Option 1 but now with a port to remember.
- Users who ran ZeroU in CI / from a script don't get the live view anyway — needs to fall back to Option 1's static HTML.
- Daemon-style background services are explicitly **MVP-1+ deferred** per `CLAUDE.md` ("系统服务化 daemon" is on the punt list).

---

### Option 3: Terminal TUI with `ink`

**What user sees**: Full-screen TTY app while running — left pane file tree, right pane live diff, status bar at bottom.

**Tech stack**:
- `ink` (React for CLI) ~3 MB tree, or `blessed` ~600 KB.
- Custom diff viewer component, file tree component, status bar.

**Effort**: ~3-5 dev-days. ~800 LOC + a non-trivial new dep.

**Pros**:
- Native terminal feel; no browser context-switch.
- Real-time by definition.
- `tig`/`lazygit` users love this UX.

**Cons**:
- TUI does not survive past process exit. User asked for "perceive every change *afterwards*, not in real time" — TUI fails this.
- `ink` adds React + Yoga layout engine to a project that has *zero* React. That's a values violation.
- Windows console quirks (raw mode, ANSI support, CJK width) are non-trivial.
- TUI diff is still a flat scroll — doesn't beat side-by-side in a browser pane.
- Side-by-side in a TUI requires wide terminals; demo authors often work in narrow side-panel terminals (Cursor, VSCode integrated terminal).

---

## Recommendation

**Ship Option 1 (single-file HTML + compact stdout).** Backup: if hand-rolling the side-by-side renderer eats more than 1 day of the budget, drop in `diff2html` as a vendored static file (no npm dep — paste the standalone build into `cli/src/enhance/vendor/diff2html.js`, ~120 KB).

Rationale:
1. **Zero deps** is non-negotiable — current install footprint is `commander + zod`. Adding `ink` or any web framework breaks our "lightweight CLI" story.
2. **Final-only is fine** if stdout is punchy enough. The user complaint was specifically "I can't *review* changes without reading JSON" — that's a post-run problem, not a during-run problem.
3. **Cross-platform browser-based** is the lowest-friction "review surface" on Windows/macOS/Linux. We already write a file; we just write a second one.
4. **Identity-reinforcing**: the HTML page literally is "the diff, before you merge." That's the product.
5. Markdown stays the canonical text artifact — no regression.

The `zerou review` shortcut command (open default browser to the HTML file) is the `gh pr view --web` ergonomic borrow.

---

## Implementation sketch

New files:

```
cli/src/enhance/
  html-report.ts            ← single entry: writeEnhanceHtmlReport(opts)
  html-template.ts          ← string template + inlined CSS + inlined JS
  diff-sxs.ts               ← parseDiffToSideBySide(unifiedDiff) → SxsModel
  syntax-light.ts           ← tokenize(line, lang) → [{kind, text}]
cli/src/enhance/vendor/     ← (only if backup activated)
  diff2html.bundle.js
```

Module shapes (no code — just shape):

```ts
// html-report.ts
export interface HtmlReportOpts {
  cwd: string;
  reportPath: string;        // ".zerou/enhance-report.html"
  result: EnhanceFlowResult; // reused from existing types
  diffs: FileDiff[];         // already fetched by report.ts
  logger: TrackLogger;
}
export async function writeEnhanceHtmlReport(opts: HtmlReportOpts): Promise<void>;

// html-template.ts
export function renderHtml(model: HtmlModel): string;
interface HtmlModel {
  project: string;
  branch: string;
  worktreePath: string;
  startedAt: string;
  durationMs: number;
  verifyOk: boolean;
  modules: ModuleSummary[];  // chips: { id, label, fileCount }
  files: FileNode[];         // tree: { path, module, additions, deletions, status, sxs?, omittedReason? }
  mergeCmd: string;
  dropCmd: string;
}

// diff-sxs.ts
export interface SxsHunk {
  leftStart: number; rightStart: number;
  rows: Array<{ kind: 'eq'|'add'|'del'|'blank'; left?: string; right?: string }>;
}
export function parseDiffToSideBySide(unifiedDiff: string): SxsHunk[];
```

Wiring point: `cli/src/enhance.ts` after `writeEnhanceReport(...)` call (line 348). Add a second await:

```ts
await writeEnhanceHtmlReport({ cwd, reportPath: reportPath.replace(/\.md$/, '.html'),
                                result, diffs, logger });
writeOut(`🌐 HTML:    ${htmlPath}  ← open in browser\n`);
```

Stdout compaction: replace the current ~30-line stream with the 8-line block shown in the mockup. Refactor existing `writeOut('▶ Module …')` calls in `enhance.ts` to push to a `lineBuf` and print one summary line per module at module-exit. Pure cosmetic change inside `enhance.ts` — ~80 LOC delta.

New CLI verb: `zerou review` → resolve `<cwd>/.zerou/enhance-report.html` → `child_process.spawn('start' on win32 / 'open' on darwin / 'xdg-open' on linux, [path])`. ~20 LOC. Add to `cli/src/cli.ts` command table.

**Total effort estimate**: 2-3 dev-days, ~600 LOC new code, ~80 LOC churn in `enhance.ts`, zero new deps.

**Test plan** (must ship with the feature per `surface_without_self_test` rule):
- `vitest` unit: `parseDiffToSideBySide` golden-file tests for add/del/rename/new/binary.
- `vitest` integration: `writeEnhanceHtmlReport` against a fixture `EnhanceFlowResult` — assert generated HTML contains `<title>`, all 12 file paths, the merge command, all 5 module chips.
- Smoke: `node scripts/smoke-walking-skeleton.mjs` extended to assert `.zerou/enhance-report.html` exists and is > 5 KB after a real `zerou enhance` run on the fixtures demo.
- Cross-engine probe (Gates 1+2+3): haiku probe + general-purpose subagent probe both confirm the file's `<h1>` text matches the spec; gate-3 runs the actual `zerou enhance` and opens the HTML in a headless browser to assert no JS errors.

---

## Open questions for user

1. **Live progress in HTML — needed in MVP, or v1.1?** Recommendation: defer. Compact stdout handles the "I want to watch" itch; HTML is the post-mortem surface. Confirm we can punt SSE to v1.1.

2. **`zerou review` command — auto-open browser, or just print the path?** Recommendation: auto-open on `zerou enhance` exit *if* `--open` flag passed (off by default — don't surprise CI). Bare `zerou review` always opens.

3. **Backup activation trigger.** If `parseDiffToSideBySide` + `syntax-light` exceeds 250 LOC during implementation, switch to vendored `diff2html.bundle.js`. OK to make this call mid-implementation without re-grilling?

4. **Audit-report (the other artifact) — same treatment now, or follow-up PR?** Recommendation: follow-up. Phase 11 ships enhance.html; audit.html in Phase 12 reusing the template. Confirm this split.

5. **HTML report — overwrite each run, or keep history under `.zerou/runs/<ts>/`?** Recommendation: overwrite + symlink-to-latest pattern (`enhance-report.html` is current; `runs/<ts>/enhance-report.html` is archived). Lets user diff across runs later. Worth +1 dev-day?

6. **Module filter chip taxonomy.** Use raw module IDs (`log-injection`, `bug-patcher`, …) or friendlier labels (`Observability`, `Bug fixes`, `Health`, `Error tracking`, `Config`)? Recommendation: friendly labels — they reinforce "what ZeroU is for" framing. Confirm?
