/**
 * Phase 11.5 — Branch-tree HTML renderer.
 *
 * Pure functions that take a `BranchCoverageReport` and emit HTML strings for
 * the FUNCTIONS section in the dense table-driven enhance report. The
 * renderer is I/O-free: callers (HtmlReportWriter) feed the data and stitch
 * the result between marker comments.
 *
 * Layout:
 *
 *   FUNCTIONS (N · M self-deceiving · K untested)        [filter dropdown]
 *   ─────────────────────────────────────────────────────────────────────
 *   ✅  app/api/login.ts · handleLogin     6 br  5✓  0⚠  1🔴   [3 specs]
 *   🔴  app/api/signup.ts · POST           4 br  1✓  0⚠  3🔴   [2 specs]
 *
 * Each row is `<details><summary>…</summary><div>ASCII tree</div></details>`.
 *
 * The expanded tree uses monospace ASCII drawing (├── │   └──) and renders
 * 4 signal badges per branch: AST · SPEC · JUDGE · RUN.
 *
 * Authority: docs/plans/2026-05-27-phase-11-5-branch-coverage.md (Worker-B).
 */

import { escapeHtml } from './html-diff.js';
import type {
  BranchCoverageReport,
  BranchNode,
  BranchVerdict,
  FunctionCoverage,
} from '../agent/branch-coverage-types.js';

// ── Verdict glyphs ─────────────────────────────────────────────────────────

/** Per-branch glyph + CSS class. */
function branchGlyph(verdict: BranchVerdict): { glyph: string; cls: string; label: string } {
  switch (verdict) {
    case 'covered':
      return { glyph: '✅', cls: 'bn-covered', label: 'covered' };
    case 'judge-only':
      return { glyph: '🔴', cls: 'bn-judge-only', label: 'self-deceiving' };
    case 'spec-only':
      return { glyph: '⚠', cls: 'bn-spec-only', label: 'spec only' };
    case 'run-only':
      return { glyph: '⚠', cls: 'bn-run-only', label: 'run only' };
    case 'untested':
      return { glyph: '🔴', cls: 'bn-untested', label: 'untested' };
    case 'unknown':
    default:
      return { glyph: '·', cls: 'bn-unknown', label: 'unknown' };
  }
}

/**
 * Verdict for the FUNCTION row, derived from per-branch counts.
 *   ✅ if no self-deceiving AND no untested
 *   ⚠  if no self-deceiving but >=1 untested
 *   🔴 if any self-deceiving branch
 */
function functionGlyph(fn: FunctionCoverage): { glyph: string; cls: string } {
  if (fn.selfDeceivingCount > 0) return { glyph: '🔴', cls: 'fn-deceiving' };
  if (fn.untestedCount > 0) return { glyph: '⚠', cls: 'fn-partial' };
  return { glyph: '✅', cls: 'fn-covered' };
}

// ── Top-level section renderer ─────────────────────────────────────────────

/**
 * Render the FUNCTIONS section: header (with count summary), filter
 * dropdown, then one collapsible row per function. Returns the inner HTML
 * (the surrounding `<section>` is supplied by html-report.ts).
 */
export function renderFunctionsSection(report: BranchCoverageReport): string {
  const { summary, functions } = report;
  if (!functions || functions.length === 0) {
    return [
      `<div class="fn-section-header">`,
      `<span class="fn-counts">0 functions analyzed</span>`,
      `</div>`,
      `<div class="empty">No functions analyzed.</div>`,
    ].join('');
  }

  const sorted = [...functions].sort((a, b) => {
    // Self-deceiving first, then untested, then by branch count desc.
    if (b.selfDeceivingCount !== a.selfDeceivingCount)
      return b.selfDeceivingCount - a.selfDeceivingCount;
    if (b.untestedCount !== a.untestedCount) return b.untestedCount - a.untestedCount;
    if (b.branchCount !== a.branchCount) return b.branchCount - a.branchCount;
    return a.file.localeCompare(b.file);
  });

  const header = renderFunctionsHeader(summary);
  const filter = renderFunctionsFilterBar();
  const rows = sorted.map(renderFunctionRow).join('\n');

  return [header, filter, `<div class="fn-rows">`, rows, `</div>`].join('\n');
}

function renderFunctionsHeader(summary: BranchCoverageReport['summary']): string {
  const n = summary.functionsAnalyzed;
  const deceiving = summary.functionsWithSelfDeception;
  const untested = summary.untestedTotal;
  return [
    `<div class="fn-section-header">`,
    `<span class="fn-counts">`,
    `<strong>${n}</strong> function${n === 1 ? '' : 's'}`,
    ` · <span class="fn-self-deceiving-count">${deceiving} self-deceiving</span>`,
    ` · <span class="fn-untested-count">${untested} untested branch${untested === 1 ? '' : 'es'}</span>`,
    `</span>`,
    `</div>`,
  ].join('');
}

function renderFunctionsFilterBar(): string {
  return [
    `<div class="fn-filter-bar">`,
    `<label class="fn-filter-label">filter:</label>`,
    `<select id="fn-verdict-filter">`,
    `<option value="all">All</option>`,
    `<option value="self-deceiving">Has self-deceiving</option>`,
    `<option value="untested">Has untested</option>`,
    `<option value="covered">Fully covered</option>`,
    `</select>`,
    `<input type="text" id="fn-name-filter" placeholder="⌕ function or file…" autocomplete="off">`,
    `</div>`,
  ].join('');
}

/** Render one function row (collapsed `<details>` with the expanded tree inside). */
export function renderFunctionRow(fn: FunctionCoverage): string {
  const summary = renderFunctionSummary(fn);
  const tree = renderBranchTree(fn);
  const fg = functionGlyph(fn);
  const nameLower = `${fn.name} ${fn.file}`.toLowerCase();
  return [
    `<details class="row fn-row" `,
    `data-fn-id="${escapeHtml(fn.id)}" `,
    `data-fn-name="${escapeHtml(nameLower)}" `,
    `data-fn-self-deceiving="${fn.selfDeceivingCount}" `,
    `data-fn-untested="${fn.untestedCount}" `,
    `data-fn-covered="${fn.coveredCount}" `,
    `data-fn-verdict="${escapeHtml(fg.cls)}">`,
    `<summary>`,
    summary,
    `</summary>`,
    `<div class="fn-expand">`,
    tree,
    `</div>`,
    `</details>`,
  ].join('');
}

/** Render the `<summary>` content for a function row (collapsed state). */
export function renderFunctionSummary(fn: FunctionCoverage): string {
  const fg = functionGlyph(fn);
  const specCount = fn.associatedSpecs.length;
  return [
    `<span class="fn-glyph ${fg.cls}">${fg.glyph}</span>`,
    `<span class="fn-path">${escapeHtml(fn.file)} <span class="fn-sep">·</span> <span class="fn-name">${escapeHtml(fn.name)}</span></span>`,
    `<span class="fn-stat fn-stat-branches"><strong>${fn.branchCount}</strong> br</span>`,
    `<span class="fn-stat fn-stat-covered" title="covered">${fn.coveredCount}<span class="fn-stat-glyph">✓</span></span>`,
    `<span class="fn-stat fn-stat-untested" title="untested">${fn.untestedCount}<span class="fn-stat-glyph">⚠</span></span>`,
    `<span class="fn-stat fn-stat-deceiving" title="self-deceiving">${fn.selfDeceivingCount}<span class="fn-stat-glyph">🔴</span></span>`,
    `<span class="fn-spec-count">[${specCount} spec${specCount === 1 ? '' : 's'}]</span>`,
  ].join('');
}

// ── Branch tree rendering (ASCII art with HTML row-per-line) ───────────────

/** Render the expanded branch-tree HTML for one function. */
export function renderBranchTree(fn: FunctionCoverage): string {
  const headerText = `${fn.name} · ${fn.file}:${fn.line}  (${fn.branchCount} branches · ${fn.coveredCount} covered · ${fn.selfDeceivingCount} self-deceiving)`;
  const header = `<div class="branch-tree-header">${escapeHtml(headerText)}</div>`;

  const rootChildren = fn.root.children;
  // If the root has no children AND the root itself has no useful label,
  // still render the root so the tree isn't blank.
  const hasAny = rootChildren.length > 0 || !!fn.root.label;
  if (!hasAny) {
    return [header, `<div class="branch-tree-empty">no branches found</div>`].join('');
  }

  const rows = buildAsciiTreeRows(fn.root);
  if (rows.length === 0) {
    return [header, `<div class="branch-tree-empty">no branches found</div>`].join('');
  }

  return [
    header,
    `<div class="branch-tree">`,
    rows.join('\n'),
    `</div>`,
  ].join('');
}

/**
 * Walk the BranchNode tree depth-first and emit one row per node with ASCII
 * tree glyphs (├── / └── / │   /     ) prefixed. Returns the list of HTML
 * row strings (one `<div class="branch-row">` per node). The root is
 * rendered as the first row using a `└── ` prefix (no preceding sibling).
 *
 * `indentPrefix` is the prefix that should appear BEFORE this node's
 * branch-glyph (`├── ` or `└── `). For the root we pass `''`.
 */
export function buildAsciiTreeRows(root: BranchNode, indent: string = ''): string[] {
  const out: string[] = [];

  // Walk a single node + its subtree.
  // - `isLast`: is this node the last child among its siblings?
  // - `parentIndent`: indent string of the parent's row (without the parent's branch glyph).
  function walk(node: BranchNode, parentIndent: string, isLast: boolean, isRoot: boolean): void {
    let rowPrefix: string;
    let childIndent: string;
    if (isRoot) {
      // Root row has no branch glyph.
      rowPrefix = parentIndent;
      childIndent = parentIndent;
    } else {
      rowPrefix = parentIndent + (isLast ? '└── ' : '├── ');
      childIndent = parentIndent + (isLast ? '    ' : '│   ');
    }
    out.push(renderBranchRow(node, rowPrefix));
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child) continue;
      const last = i === children.length - 1;
      walk(child, childIndent, last, false);
    }
  }

  walk(root, indent, true, true);
  return out;
}

/**
 * Render one branch row's HTML: `<prefix> <glyph> <label>  <badges> [marker]`.
 *
 * The prefix is rendered inside a monospace span so the ├ / └ / │ glyphs
 * align column-wise across rows.
 */
function renderBranchRow(node: BranchNode, prefix: string): string {
  const verdict = branchGlyph(node.verdict);
  const label = node.label || node.id || '(unnamed)';
  const badges = renderSignalBadges(node);
  const marker =
    node.verdict === 'judge-only'
      ? `<span class="bn-marker bn-marker-deceiving">⚠ self-deceiving</span>`
      : '';
  return [
    `<div class="branch-row ${verdict.cls}" data-verdict="${escapeHtml(verdict.label)}" data-branch-id="${escapeHtml(node.id)}">`,
    `<span class="bn-prefix">${escapeHtml(prefix)}</span>`,
    `<span class="bn-glyph" title="${escapeHtml(verdict.label)}">${verdict.glyph}</span>`,
    `<span class="bn-label">${escapeHtml(label)}</span>`,
    `<span class="bn-badges">${badges}</span>`,
    marker,
    `</div>`,
  ].join('');
}

/** Render the 4 signal badges (AST · SPEC · JUDGE · RUN) for a branch. */
function renderSignalBadges(node: BranchNode): string {
  // AST — always present (the branch literally exists in source).
  const ast = `<span class="bn-badge bn-badge-ast" title="AST present">AST</span>`;

  // SPEC — names of specs whose `then` matched this branch.
  let spec: string;
  if (node.specMatches.length === 0) {
    spec = `<span class="bn-badge bn-badge-spec bn-badge-off" title="no specs">no specs</span>`;
  } else {
    const names = node.specMatches
      .map((m) => m.specName || m.specId)
      .slice(0, 3)
      .join(', ');
    const more = node.specMatches.length > 3 ? ` +${node.specMatches.length - 3}` : '';
    spec = `<span class="bn-badge bn-badge-spec" title="${escapeHtml(names + more)}">SPEC ${escapeHtml(truncate(names, 32))}${escapeHtml(more)}</span>`;
  }

  // JUDGE — did the LLM-judge quote a snippet within this branch's range?
  let judge: string;
  if (node.judgeEvidence.length === 0) {
    judge = `<span class="bn-badge bn-badge-judge bn-badge-off" title="judge silent">JUDGE —</span>`;
  } else {
    const anyPass = node.judgeEvidence.some((e) => e.status === 'pass');
    const sym = anyPass ? '✓' : '✗';
    judge = `<span class="bn-badge bn-badge-judge bn-badge-${anyPass ? 'on' : 'fail'}" title="judge cited">JUDGE ${sym}</span>`;
  }

  // RUN — vitest coverage hit?
  let run: string;
  if (node.runtimeCoverage.branchHit === null) {
    run = `<span class="bn-badge bn-badge-run bn-badge-off" title="no coverage data">RUN —</span>`;
  } else if (node.runtimeCoverage.branchHit) {
    run = `<span class="bn-badge bn-badge-run bn-badge-on" title="branch hit by tests">RUN ✓</span>`;
  } else {
    run = `<span class="bn-badge bn-badge-run bn-badge-fail" title="branch never hit">RUN ✗</span>`;
  }

  return [ast, spec, judge, run].join('');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// ── Test exports ───────────────────────────────────────────────────────────

export const __branchTreeInternals = {
  branchGlyph,
  functionGlyph,
  renderSignalBadges,
  renderBranchRow,
  truncate,
};
