/**
 * Phase 11.4 — dense table-driven HTML enhance report.
 *
 * Emits one self-contained HTML file with inlined CSS + JS. Append-friendly:
 *
 *   const writer = new HtmlReportWriter({...});
 *   await writer.writeSkeleton();          // status="running", meta refresh on
 *   await writer.appendFileChange(...);    // streamed in as modules complete
 *   await writer.setFindings(...);         // findings table populated
 *   await writer.setVerify(verifyResult);
 *   await writer.finalize(durationMs);     // status="pass"/"fail", refresh off
 *
 * Layout (user-blessed mockup):
 *
 *   ZeroU enhance · <project> · <duration> · <verify-status>
 *   Summary: N files | +X -Y | M log sites | K findings (P patched / R rejected)
 *   Filter bar: [All ▼] [Modules: 📝 🐛 🏥 🚨 🔧 📦] [Sort] [⌕ filter]
 *   FILES (N) — dense rows, click to expand inline diff
 *   FINDINGS (K) — sorted P1→P3, click for given/when/then + reject reason
 *   VERIFY — install ✅ tsc ✅ test ❌ build ⏭
 *   Footer with copy buttons
 *
 * Authority: D:\lll\d2p\docs\reviews\2026-05-27-presentation-layer.md
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { renderDiffHtml, escapeHtml } from './html-diff.js';
import { REPORT_CSS, REPORT_JS } from './html-assets.js';
import { renderFunctionsSection } from './branch-tree-renderer.js';
import { testFailsToFindings } from './test-fail-to-finding.js';
import type { TrackLogger } from '../log-types.js';
import type { TestCaseResult } from '../agent/types.js';
import type { BranchCoverageReport } from '../agent/branch-coverage-types.js';
import type {
  FileDiff,
  EnhanceFlowResult,
  VerifyResult,
  AuditFinding,
  PatchResult,
} from './types.js';

// ── Marker comments — append seams ────────────────────────────────────────

export const HTML_MARKERS = {
  headStatusStart: '<!--ZEROU:HEAD_STATUS_START-->',
  headStatusEnd: '<!--ZEROU:HEAD_STATUS_END-->',
  summaryStart: '<!--ZEROU:SUMMARY_START-->',
  summaryEnd: '<!--ZEROU:SUMMARY_END-->',
  navStart: '<!--ZEROU:NAV_START-->',
  navEnd: '<!--ZEROU:NAV_END-->',
  changesStart: '<!--ZEROU:CHANGES_START-->',
  changesEnd: '<!--ZEROU:CHANGES_END-->',
  filesCountStart: '<!--ZEROU:FILES_COUNT_START-->',
  filesCountEnd: '<!--ZEROU:FILES_COUNT_END-->',
  findingsStart: '<!--ZEROU:FINDINGS_START-->',
  findingsEnd: '<!--ZEROU:FINDINGS_END-->',
  findingsCountStart: '<!--ZEROU:FINDINGS_COUNT_START-->',
  findingsCountEnd: '<!--ZEROU:FINDINGS_COUNT_END-->',
  functionsStart: '<!--ZEROU:FUNCTIONS_START-->',
  functionsEnd: '<!--ZEROU:FUNCTIONS_END-->',
  functionsCountStart: '<!--ZEROU:FUNCTIONS_COUNT_START-->',
  functionsCountEnd: '<!--ZEROU:FUNCTIONS_COUNT_END-->',
  verifyStart: '<!--ZEROU:VERIFY_START-->',
  verifyEnd: '<!--ZEROU:VERIFY_END-->',
  footerStart: '<!--ZEROU:FOOTER_START-->',
  footerEnd: '<!--ZEROU:FOOTER_END-->',
  refreshStart: '<!--ZEROU:REFRESH_START-->',
  refreshEnd: '<!--ZEROU:REFRESH_END-->',
  durationStart: '<!--ZEROU:DURATION_START-->',
  durationEnd: '<!--ZEROU:DURATION_END-->',
} as const;

export interface HtmlReportOpts {
  /** Absolute output path for the HTML file. */
  reportPath: string;
  /** Project display name (basename of cwd usually). */
  project: string;
  /** Worktree branch name (used in copy-merge-command). */
  branch: string;
  /** Worktree absolute path (used in copy-drop-command + footer). */
  worktree: string;
  /** Where the markdown report lives (relative to reportPath dir or absolute). */
  markdownPath: string;
  /** Logger for branch / catch events. */
  logger?: TrackLogger;
}

export interface FileChangeInput {
  file: string;
  /** Modules this file belongs to — drives the filter chips. */
  modules: string[];
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  unifiedDiff: string;
  /** Optional "why" caption pulled from module decisions. */
  decisionReason?: string;
  /** If the diff was omitted (lockfile, binary, too large) state why. */
  omittedReason?: string;
  /** For renamed entries. */
  oldFile?: string;
}

export interface FindingRowInput {
  finding: AuditFinding;
  applied: boolean;
  rejectReason?: string;
}

export class HtmlReportWriter {
  readonly reportPath: string;
  readonly project: string;
  readonly branch: string;
  readonly worktree: string;
  readonly markdownPath: string;
  private readonly logger?: TrackLogger;
  /** True after `finalize()` so live-refresh meta is stripped. */
  private finalized = false;
  /** Tracks module ids → file counts so nav chips can show counts. */
  private moduleCounts: Map<string, number> = new Map();
  /** Tracks total file count and additions/deletions for the summary. */
  private fileCount = 0;
  private additions = 0;
  private deletions = 0;
  /** Last verify recorded, for stat reflow on finalize. */
  private verifyResult: VerifyResult | null = null;
  /** Log-site count for summary header (set by appendFromFileDiffs). */
  private logSiteCount = 0;
  /** Findings counts. */
  private findingsTotal = 0;
  private findingsApplied = 0;
  private findingsRejected = 0;
  /** Branch coverage data (Phase 11.5). */
  private branchCoverage: BranchCoverageReport | null = null;

  constructor(opts: HtmlReportOpts) {
    this.reportPath = opts.reportPath;
    this.project = opts.project;
    this.branch = opts.branch;
    this.worktree = opts.worktree;
    this.markdownPath = opts.markdownPath;
    this.logger = opts.logger;
  }

  /** Write the empty skeleton with "Running..." status + auto-refresh meta. */
  async writeSkeleton(): Promise<void> {
    const html = renderSkeleton({
      project: this.project,
      branch: this.branch,
      worktree: this.worktree,
      markdownPath: this.markdownPath,
      running: true,
    });
    await fs.mkdir(path.dirname(this.reportPath), { recursive: true });
    await fs.writeFile(this.reportPath, html, 'utf8');
    this.logger?.log('info', 'enhance.html.skeleton', { reportPath: this.reportPath });
  }

  /**
   * Append a per-file change row. Splices between CHANGES_START and
   * CHANGES_END markers. Updates module-count nav chips.
   */
  async appendFileChange(input: FileChangeInput): Promise<void> {
    const row = renderFileRow(input);

    // Update counters.
    this.fileCount++;
    this.additions += input.additions;
    this.deletions += input.deletions;
    for (const m of input.modules.length > 0 ? input.modules : ['other']) {
      this.moduleCounts.set(m, (this.moduleCounts.get(m) ?? 0) + 1);
    }

    let html = await fs.readFile(this.reportPath, 'utf8');
    html = spliceBetween(html, HTML_MARKERS.changesStart, HTML_MARKERS.changesEnd, (inner) => {
      // Strip any "empty" placeholder when the first row arrives.
      const cleaned = inner.replace(/<div class="empty[^"]*">[^<]*<\/div>/gi, '');
      return cleaned + '\n' + row;
    });
    html = spliceBetween(html, HTML_MARKERS.navStart, HTML_MARKERS.navEnd, () =>
      renderNavChips(this.moduleCounts),
    );
    html = spliceBetween(html, HTML_MARKERS.summaryStart, HTML_MARKERS.summaryEnd, () =>
      renderSummaryStats({
        files: this.fileCount,
        additions: this.additions,
        deletions: this.deletions,
        verify: this.verifyResult,
        logSites: this.logSiteCount,
        findingsTotal: this.findingsTotal,
        findingsApplied: this.findingsApplied,
        findingsRejected: this.findingsRejected,
      }),
    );
    html = spliceBetween(html, HTML_MARKERS.filesCountStart, HTML_MARKERS.filesCountEnd, () =>
      String(this.fileCount),
    );

    await fs.writeFile(this.reportPath, html, 'utf8');
  }

  /** Convenience: append many files in one go. */
  async appendFileChanges(inputs: FileChangeInput[]): Promise<void> {
    for (const inp of inputs) await this.appendFileChange(inp);
  }

  /** Bulk-append from FileDiff[] + module-mapping function. */
  async appendFromFileDiffs(
    diffs: FileDiff[],
    moduleOf: (file: string) => string[],
    reasonOf?: (file: string) => string | undefined,
  ): Promise<void> {
    for (const d of diffs) {
      await this.appendFileChange({
        file: d.file,
        modules: moduleOf(d.file),
        status: d.status,
        additions: d.additions,
        deletions: d.deletions,
        unifiedDiff: d.unifiedDiff,
        omittedReason: d.omittedReason,
        oldFile: d.oldFile,
        decisionReason: reasonOf?.(d.file),
      });
    }
  }

  /** Set log-site count (drives "M log sites" stat). */
  async setLogSiteCount(n: number): Promise<void> {
    this.logSiteCount = n;
    let html = await fs.readFile(this.reportPath, 'utf8');
    html = spliceBetween(html, HTML_MARKERS.summaryStart, HTML_MARKERS.summaryEnd, () =>
      renderSummaryStats({
        files: this.fileCount,
        additions: this.additions,
        deletions: this.deletions,
        verify: this.verifyResult,
        logSites: this.logSiteCount,
        findingsTotal: this.findingsTotal,
        findingsApplied: this.findingsApplied,
        findingsRejected: this.findingsRejected,
      }),
    );
    await fs.writeFile(this.reportPath, html, 'utf8');
  }

  /** Populate the findings table from a pre-sorted list. */
  async setFindings(findings: FindingRowInput[]): Promise<void> {
    this.findingsTotal = findings.length;
    this.findingsApplied = findings.filter((f) => f.applied).length;
    this.findingsRejected = this.findingsTotal - this.findingsApplied;

    let html = await fs.readFile(this.reportPath, 'utf8');
    html = spliceBetween(html, HTML_MARKERS.findingsStart, HTML_MARKERS.findingsEnd, () =>
      renderFindingsBody(findings),
    );
    html = spliceBetween(html, HTML_MARKERS.findingsCountStart, HTML_MARKERS.findingsCountEnd, () =>
      String(this.findingsTotal),
    );
    html = spliceBetween(html, HTML_MARKERS.summaryStart, HTML_MARKERS.summaryEnd, () =>
      renderSummaryStats({
        files: this.fileCount,
        additions: this.additions,
        deletions: this.deletions,
        verify: this.verifyResult,
        logSites: this.logSiteCount,
        findingsTotal: this.findingsTotal,
        findingsApplied: this.findingsApplied,
        findingsRejected: this.findingsRejected,
      }),
    );
    await fs.writeFile(this.reportPath, html, 'utf8');
  }

  /**
   * Set the branch-coverage report (Phase 11.5). Splices the FUNCTIONS
   * section between FINDINGS and VERIFY. Calling it again replaces the
   * previously rendered section.
   */
  async setBranchCoverage(report: BranchCoverageReport): Promise<void> {
    this.branchCoverage = report;
    let html = await fs.readFile(this.reportPath, 'utf8');
    html = spliceBetween(html, HTML_MARKERS.functionsStart, HTML_MARKERS.functionsEnd, () =>
      renderFunctionsSection(report),
    );
    html = spliceBetween(
      html,
      HTML_MARKERS.functionsCountStart,
      HTML_MARKERS.functionsCountEnd,
      () => String(report.summary.functionsAnalyzed),
    );
    // Reveal the section (it ships hidden in the skeleton).
    html = html.replace(
      '<section class="section fn-section-empty hidden" data-section="functions">',
      '<section class="section" data-section="functions">',
    );
    await fs.writeFile(this.reportPath, html, 'utf8');
  }

  /** Record the verify result so the summary + finalize reflect it. */
  async setVerify(verify: VerifyResult): Promise<void> {
    this.verifyResult = verify;
    let html = await fs.readFile(this.reportPath, 'utf8');
    html = spliceBetween(html, HTML_MARKERS.verifyStart, HTML_MARKERS.verifyEnd, () =>
      renderVerifyBlock(verify),
    );
    html = spliceBetween(html, HTML_MARKERS.summaryStart, HTML_MARKERS.summaryEnd, () =>
      renderSummaryStats({
        files: this.fileCount,
        additions: this.additions,
        deletions: this.deletions,
        verify,
        logSites: this.logSiteCount,
        findingsTotal: this.findingsTotal,
        findingsApplied: this.findingsApplied,
        findingsRejected: this.findingsRejected,
      }),
    );
    await fs.writeFile(this.reportPath, html, 'utf8');
  }

  /** Replace "Running..." with final status; strip auto-refresh meta. */
  async finalize(durationMs: number): Promise<void> {
    this.finalized = true;
    let html = await fs.readFile(this.reportPath, 'utf8');
    const ok = this.verifyResult?.ok ?? true;
    const statusLabel = this.verifyResult
      ? this.verifyResult.ok
        ? 'verify ✅'
        : 'verify ❌'
      : 'done';
    const statusClass = ok ? 'status-pass' : 'status-fail';

    html = spliceBetween(html, HTML_MARKERS.headStatusStart, HTML_MARKERS.headStatusEnd, () =>
      `<span class="${statusClass}">${escapeHtml(statusLabel)}</span>`,
    );
    html = spliceBetween(html, HTML_MARKERS.refreshStart, HTML_MARKERS.refreshEnd, () => '');
    html = spliceBetween(html, HTML_MARKERS.durationStart, HTML_MARKERS.durationEnd, () =>
      escapeHtml(formatDurationShort(durationMs)),
    );
    html = spliceBetween(html, HTML_MARKERS.footerStart, HTML_MARKERS.footerEnd, () =>
      renderFooter({
        durationMs,
        statusLabel,
        markdownPath: this.markdownPath,
        worktree: this.worktree,
        branch: this.branch,
      }),
    );

    if (this.fileCount === 0) {
      html = spliceBetween(html, HTML_MARKERS.changesStart, HTML_MARKERS.changesEnd, () =>
        '\n<div class="empty">No file changes detected between main and HEAD.</div>\n',
      );
    }
    if (this.findingsTotal === 0) {
      html = spliceBetween(html, HTML_MARKERS.findingsStart, HTML_MARKERS.findingsEnd, () =>
        '\n<div class="empty">No remaining findings.</div>\n',
      );
    }

    await fs.writeFile(this.reportPath, html, 'utf8');
    this.logger?.log('info', 'enhance.html.finalize', {
      reportPath: this.reportPath,
      fileCount: this.fileCount,
      durationMs,
      ok,
    });
  }

  /** Expose internal counters for tests. */
  get __state(): {
    fileCount: number;
    additions: number;
    deletions: number;
    finalized: boolean;
    moduleCounts: Map<string, number>;
    findingsTotal: number;
    findingsApplied: number;
    findingsRejected: number;
    branchCoverage: BranchCoverageReport | null;
  } {
    return {
      fileCount: this.fileCount,
      additions: this.additions,
      deletions: this.deletions,
      finalized: this.finalized,
      moduleCounts: this.moduleCounts,
      findingsTotal: this.findingsTotal,
      findingsApplied: this.findingsApplied,
      findingsRejected: this.findingsRejected,
      branchCoverage: this.branchCoverage,
    };
  }
}

// ── One-shot rendering (no live writer) ────────────────────────────────────

export interface OneShotOpts {
  reportPath: string;
  project: string;
  result: EnhanceFlowResult;
  diffs: FileDiff[] | null;
  diffError?: string | null;
  markdownPath: string;
  /** Optional: classify each file path into module ids for filter chips. */
  moduleOf?: (file: string) => string[];
  /** Optional: per-file "why ZeroU did this" caption. */
  reasonOf?: (file: string) => string | undefined;
  /** Optional: TestCaseResult[] for findings table rendering. */
  testResults?: TestCaseResult[];
  /** Optional: per-function branch coverage (Phase 11.5). */
  branchCoverage?: BranchCoverageReport;
  logger?: TrackLogger;
}

/**
 * Convenience writer that does skeleton → append all → finalize in one call.
 * Used by `enhance.ts` after the run already completed (no live-tail needed).
 */
export async function writeEnhanceHtmlReport(opts: OneShotOpts): Promise<void> {
  const writer = new HtmlReportWriter({
    reportPath: opts.reportPath,
    project: opts.project,
    branch: opts.result.branch,
    worktree: opts.result.worktreePath,
    markdownPath: opts.markdownPath,
    logger: opts.logger,
  });
  await writer.writeSkeleton();
  const moduleOf = opts.moduleOf ?? defaultModuleOf(opts.result);
  const reasonOf = opts.reasonOf ?? defaultReasonOf(opts.result);
  if (opts.diffs && opts.diffs.length > 0) {
    await writer.appendFromFileDiffs(opts.diffs, moduleOf, reasonOf);
  }
  const logSites = opts.result.modules.logPlanner?.sites.length ?? 0;
  if (logSites > 0) await writer.setLogSiteCount(logSites);

  // Build findings rows from test-results + bug-patcher decisions.
  const findingRows = buildFindingRows(opts.result, opts.testResults ?? []);
  if (findingRows.length > 0) await writer.setFindings(findingRows);

  if (opts.branchCoverage) await writer.setBranchCoverage(opts.branchCoverage);
  if (opts.result.verify) await writer.setVerify(opts.result.verify);
  await writer.finalize(opts.result.durationMs);
}

/**
 * Compose the FINDINGS rows from (a) TestCaseResult[] and (b) the
 * bug-patcher's PatchResult[] so each row knows whether it was applied and
 * why it was rejected.
 *
 * Sorted: P1 → P2 → P3, then by file path (test-fail-to-finding already
 * stable-sorts the inputs, but we re-sort here in case caller passed raw).
 */
export function buildFindingRows(
  result: EnhanceFlowResult,
  testResults: TestCaseResult[],
): FindingRowInput[] {
  // Start with all test-fail findings (rich detail).
  const fromTests = testFailsToFindings({ results: testResults });

  // Patcher decisions keyed by id (preserves traceability).
  const decisions = new Map<string, PatchResult>();
  for (const pr of result.modules.bugPatcher ?? []) {
    decisions.set(pr.finding.id, pr);
  }

  // Also include any static findings the patcher saw that aren't in test
  // results (e.g. from audit-report.md), so the user sees a complete picture.
  const seenIds = new Set(fromTests.map((f) => f.id));
  const fromPatcher: AuditFinding[] = [];
  for (const pr of result.modules.bugPatcher ?? []) {
    if (!seenIds.has(pr.finding.id)) fromPatcher.push(pr.finding);
  }

  const all = [...fromTests, ...fromPatcher];
  const rows: FindingRowInput[] = all.map((f) => {
    const d = decisions.get(f.id);
    return {
      finding: f,
      applied: d?.status === 'applied',
      rejectReason: d?.status === 'applied' ? undefined : d?.reason,
    };
  });

  const SEV_RANK: Record<'P1' | 'P2' | 'P3', number> = { P1: 3, P2: 2, P3: 1 };
  rows.sort((a, b) => {
    const d = SEV_RANK[b.finding.severity] - SEV_RANK[a.finding.severity];
    if (d !== 0) return d;
    if (a.finding.file !== b.finding.file) return a.finding.file.localeCompare(b.finding.file);
    return a.finding.line - b.finding.line;
  });
  return rows;
}

// ── Skeleton rendering ────────────────────────────────────────────────────

interface SkeletonOpts {
  project: string;
  branch: string;
  worktree: string;
  markdownPath: string;
  running: boolean;
}

function renderSkeleton(opts: SkeletonOpts): string {
  const title = `ZeroU enhance — ${opts.project}`;
  const refreshMeta = opts.running ? '<meta http-equiv="refresh" content="2">' : '';
  return [
    '<!doctype html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `${HTML_MARKERS.refreshStart}${refreshMeta}${HTML_MARKERS.refreshEnd}`,
    `<style>${REPORT_CSS}</style>`,
    '</head><body>',
    // Sticky header — title strip
    '<header class="sticky">',
    '<div class="title">',
    `<h1>ZeroU enhance</h1>`,
    `<span class="sep">·</span>`,
    `<span class="meta">${escapeHtml(opts.project)}</span>`,
    `<span class="sep">·</span>`,
    `<span class="meta">${HTML_MARKERS.durationStart}—${HTML_MARKERS.durationEnd}</span>`,
    `<span class="sep">·</span>`,
    `${HTML_MARKERS.headStatusStart}<span class="status-running">running…</span>${HTML_MARKERS.headStatusEnd}`,
    '</div>',
    `<div class="hotkey-hint"><kbd>?</kbd> hotkeys</div>`,
    '</header>',
    // Summary stat strip
    `<section class="summary">${HTML_MARKERS.summaryStart}${renderSummaryStats({
      files: 0, additions: 0, deletions: 0, verify: null,
      logSites: 0, findingsTotal: 0, findingsApplied: 0, findingsRejected: 0,
    })}${HTML_MARKERS.summaryEnd}</section>`,
    // Filter bar
    '<div class="filter-bar">',
    `<div class="group"><span class="group-label">modules:</span>${HTML_MARKERS.navStart}${renderNavChips(new Map())}${HTML_MARKERS.navEnd}</div>`,
    `<div class="group"><span class="group-label">severity:</span>${renderSeveritySelect()}</div>`,
    `<div class="group"><input type="text" id="filter-input" placeholder="⌕ filter…" autocomplete="off"></div>`,
    '</div>',
    // FILES section
    `<section class="section" data-section="files">`,
    `<h2>files <span class="count">${HTML_MARKERS.filesCountStart}0${HTML_MARKERS.filesCountEnd}</span></h2>`,
    `${HTML_MARKERS.changesStart}\n<div class="empty">running… file changes will appear here as modules complete.</div>\n${HTML_MARKERS.changesEnd}`,
    '</section>',
    // FINDINGS section
    `<section class="section" data-section="findings">`,
    `<h2>findings <span class="count">${HTML_MARKERS.findingsCountStart}0${HTML_MARKERS.findingsCountEnd}</span></h2>`,
    `${HTML_MARKERS.findingsStart}\n<div class="empty">No remaining findings.</div>\n${HTML_MARKERS.findingsEnd}`,
    '</section>',
    // FUNCTIONS section (branch coverage). Hidden until setBranchCoverage()
    // is called — kept in the DOM with marker comments so splice operations
    // stay consistent across writer methods.
    `<section class="section fn-section-empty hidden" data-section="functions">`,
    `<h2>functions <span class="count">${HTML_MARKERS.functionsCountStart}0${HTML_MARKERS.functionsCountEnd}</span></h2>`,
    `${HTML_MARKERS.functionsStart}${HTML_MARKERS.functionsEnd}`,
    `</section>`,
    // VERIFY section
    `<section class="section" data-section="verify">`,
    `<h2>verify</h2>`,
    `${HTML_MARKERS.verifyStart}<div class="empty">verify pending…</div>${HTML_MARKERS.verifyEnd}`,
    '</section>',
    // Footer with copy buttons
    `<footer>${HTML_MARKERS.footerStart}${renderFooter({
      durationMs: 0,
      statusLabel: 'running…',
      markdownPath: opts.markdownPath,
      worktree: opts.worktree,
      branch: opts.branch,
    })}${HTML_MARKERS.footerEnd}</footer>`,
    // Hotkey help overlay
    renderHotkeyOverlay(),
    `<script>${REPORT_JS}</script>`,
    '</body></html>',
  ].join('\n');
}

// ── Section renderers ─────────────────────────────────────────────────────

interface SummaryStatsOpts {
  files: number;
  additions: number;
  deletions: number;
  verify: VerifyResult | null;
  logSites: number;
  findingsTotal: number;
  findingsApplied: number;
  findingsRejected: number;
}

function renderSummaryStats(o: SummaryStatsOpts): string {
  const verifyLabel = o.verify
    ? o.verify.ok
      ? '<span class="status-pass">✅ verify</span>'
      : '<span class="status-fail">❌ verify</span>'
    : '<span class="status-running">⏳ verify</span>';
  return [
    `<div class="stat"><strong>${o.files}</strong> file${o.files === 1 ? '' : 's'}</div>`,
    `<div class="stat"><span class="plus">+${o.additions}</span> <span class="minus">-${o.deletions}</span></div>`,
    `<div class="stat"><strong>${o.logSites}</strong> log site${o.logSites === 1 ? '' : 's'}</div>`,
    `<div class="stat"><strong>${o.findingsTotal}</strong> finding${o.findingsTotal === 1 ? '' : 's'} (${o.findingsApplied} patched / ${o.findingsRejected} rejected)</div>`,
    `<div class="stat">${verifyLabel}</div>`,
  ].join('');
}

function renderNavChips(counts: Map<string, number>): string {
  const parts: string[] = [
    `<button class="chip" data-module="__all__" aria-pressed="true">all</button>`,
  ];
  const sorted = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [mod, n] of sorted) {
    const friendly = moduleFriendlyName(mod);
    parts.push(
      `<button class="chip" data-module="${escapeHtml(mod)}" aria-pressed="false">${escapeHtml(friendly)} ${n}</button>`,
    );
  }
  return parts.join('');
}

function renderSeveritySelect(): string {
  return [
    `<select id="severity-filter">`,
    `<option value="all">all</option>`,
    `<option value="P1">P1</option>`,
    `<option value="P2">P2</option>`,
    `<option value="P3">P3</option>`,
    `</select>`,
  ].join('');
}

function moduleFriendlyName(id: string): string {
  switch (id) {
    case 'logging': return '📝 logger';
    case 'log-injection': return '📝 logger';
    case 'bug-patcher': return '🐛 bug';
    case 'bugs': return '🐛 bug';
    case 'health': return '🏥 health';
    case 'sentry': return '🚨 sentry';
    case 'env': return '🔧 env';
    case 'other': return '📦 other';
    default: return id;
  }
}

function verdictForFile(file: string, status: FileChangeInput['status']): {
  glyph: string;
  cls: string;
} {
  if (isLockfile(file)) return { glyph: '⚠', cls: 'review' };
  if (file.endsWith('package.json') || file === 'package.json') {
    return { glyph: '⚠', cls: 'review' };
  }
  // ✅ safe by default — mechanical rewrite or template add.
  return { glyph: '✅', cls: 'safe' };
}

function isLockfile(file: string): boolean {
  const base = file.split('/').pop() ?? file;
  return (
    base === 'package-lock.json' ||
    base === 'pnpm-lock.yaml' ||
    base === 'yarn.lock' ||
    base === 'bun.lockb'
  );
}

function renderFileRow(input: FileChangeInput): string {
  const status = input.status;
  const statusBadge = status === 'modified'
    ? `<span class="status-badge mod">MOD</span>`
    : status === 'added'
      ? `<span class="status-badge added">NEW</span>`
      : status === 'deleted'
        ? `<span class="status-badge deleted">DEL</span>`
        : `<span class="status-badge renamed">REN</span>`;
  const counts = `<span class="counts"><span class="plus">+${input.additions}</span> <span class="minus">-${input.deletions}</span></span>`;
  const verdict = verdictForFile(input.file, status);
  const modules = input.modules.length > 0 ? input.modules : ['other'];
  const modulesAttr = modules.join(',');
  const modulesLabel = modules.map(moduleFriendlyName).join(' ');
  const why = input.decisionReason
    ? `<p class="why">${escapeHtml(input.decisionReason)}</p>`
    : '';
  const body = input.omittedReason
    ? `<div class="omitted">diff omitted: ${escapeHtml(input.omittedReason)}</div>`
    : renderDiffHtml(input.unifiedDiff);
  const renameNote = status === 'renamed' && input.oldFile
    ? ` <span class="from">← ${escapeHtml(input.oldFile)}</span>`
    : '';

  return [
    `<details class="row file-row" data-file="${escapeHtml(input.file)}" data-modules="${escapeHtml(modulesAttr)}" data-status="${escapeHtml(status)}" data-verdict="${verdict.cls}">`,
    `<summary>`,
    `<span class="verdict" title="${verdict.cls}">${verdict.glyph}</span>`,
    `<span class="path">${escapeHtml(input.file)}${renameNote}</span>`,
    statusBadge,
    counts,
    `<span class="modules">${escapeHtml(modulesLabel)}</span>`,
    `</summary>`,
    `<div class="row-expand">`,
    why,
    body,
    `</div>`,
    `</details>`,
  ].join('');
}

function renderFindingsBody(findings: FindingRowInput[]): string {
  if (findings.length === 0) {
    return '\n<div class="empty">No remaining findings.</div>\n';
  }
  return '\n' + findings.map(renderFindingRow).join('\n') + '\n';
}

function renderFindingRow(row: FindingRowInput): string {
  const f = row.finding;
  const sev = f.severity;
  const glyph = row.applied ? '●' : '○';
  const glyphCls = row.applied ? 'applied' : 'rejected';
  const target = inferTarget(f);
  const message = truncate(stripPrefix(f.message, f.id), 200);
  const detail = renderFindingDetail(row);
  return [
    `<details class="row finding-row" data-severity="${escapeHtml(sev)}" data-target="${escapeHtml(target)}" data-message="${escapeHtml(message)}" data-applied="${row.applied ? '1' : '0'}">`,
    `<summary>`,
    `<span class="sev sev-${sev}">${sev}</span>`,
    `<span class="glyph ${glyphCls}" title="${row.applied ? 'patched' : 'not patched'}">${glyph}</span>`,
    `<span class="target">${escapeHtml(target)}</span>`,
    `<span class="message">${escapeHtml(message)}</span>`,
    `</summary>`,
    detail,
    `</details>`,
  ].join('');
}

function renderFindingDetail(row: FindingRowInput): string {
  const f = row.finding;
  const dlEntries: string[] = [];
  dlEntries.push(`<dt>file</dt><dd>${escapeHtml(`${f.file}:${f.line}`)}</dd>`);
  dlEntries.push(`<dt>category</dt><dd>${escapeHtml(f.category)}</dd>`);
  if (f.message) {
    dlEntries.push(`<dt>message</dt><dd>${escapeHtml(f.message)}</dd>`);
  }
  if (f.expectedBehavior) {
    dlEntries.push(`<dt>expected</dt><dd>${escapeHtml(f.expectedBehavior)}</dd>`);
  }
  if (f.actualBehavior) {
    dlEntries.push(`<dt>actual</dt><dd>${escapeHtml(f.actualBehavior)}</dd>`);
  }
  if (f.snippet) {
    dlEntries.push(`<dt>snippet</dt><dd><pre style="margin:0;white-space:pre-wrap;">${escapeHtml(f.snippet)}</pre></dd>`);
  }
  dlEntries.push(`<dt>patched</dt><dd>${row.applied ? 'yes' : 'no'}</dd>`);
  if (!row.applied && row.rejectReason) {
    dlEntries.push(`<dt>reject reason</dt><dd class="reject">${escapeHtml(row.rejectReason)}</dd>`);
  }
  return `<div class="finding-detail"><dl>${dlEntries.join('')}</dl></div>`;
}

/** Pull a short "what does this protect" label out of a finding. */
function inferTarget(f: AuditFinding): string {
  // If category is test-case-fail-*, the message likely starts with the spec
  // name (e.g. "Anonymous access exposes graveyard entries: ..."). Use the
  // file path as the most stable identifier.
  return `${f.file}:${f.line}`;
}

function stripPrefix(msg: string, prefix: string): string {
  if (msg.startsWith(prefix + ':')) return msg.slice(prefix.length + 1).trim();
  return msg;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function renderVerifyBlock(verify: VerifyResult): string {
  const steps = verify.steps.map((s) => {
    const glyph = s.status === 'pass' ? '✅' : s.status === 'fail' ? '❌' : '⏭';
    return `<div class="step ${s.status}"><span class="name">${escapeHtml(s.name)}</span> <span class="dur">${formatDurationShort(s.durationMs)}</span> <span>${glyph}</span></div>`;
  }).join('');
  const broken = !verify.ok && verify.brokenBy
    ? `<div class="broken-by">Broken by: ${escapeHtml(verify.brokenBy)}</div>`
    : '';
  return `<div class="verify-grid">${steps}</div>${broken}`;
}

function renderHotkeyOverlay(): string {
  return [
    `<div class="hk-overlay" id="hk-overlay">`,
    `<div class="panel">`,
    `<h3>hotkeys</h3>`,
    `<dl>`,
    `<dt><kbd>f</kbd></dt><dd>focus filter</dd>`,
    `<dt><kbd>e</kbd></dt><dd>expand all files</dd>`,
    `<dt><kbd>c</kbd></dt><dd>collapse all</dd>`,
    `<dt><kbd>s</kbd></dt><dd>jump to summary</dd>`,
    `<dt><kbd>?</kbd></dt><dd>this help</dd>`,
    `<dt><kbd>esc</kbd></dt><dd>close / blur</dd>`,
    `</dl>`,
    `</div>`,
    `</div>`,
  ].join('');
}

interface FooterOpts {
  durationMs: number;
  statusLabel: string;
  markdownPath: string;
  worktree: string;
  branch: string;
}

function renderFooter(opts: FooterOpts): string {
  const duration = formatDurationShort(opts.durationMs);
  const mdHref = toFileHref(opts.markdownPath);
  const mergeCmd = `git merge --no-ff ${opts.branch}`;
  const dropCmd = `git worktree remove ${opts.worktree}`;
  return [
    `<div class="footer-meta">`,
    `duration ${escapeHtml(duration)} · status ${escapeHtml(opts.statusLabel)} · `,
    `<a href="${escapeHtml(mdHref)}">markdown report</a> · `,
    `worktree <code>${escapeHtml(opts.worktree)}</code>`,
    `</div>`,
    `<div class="footer-actions">`,
    `<button class="copy-btn" data-copy="${escapeHtml(mergeCmd)}">Copy merge command</button>`,
    `<button class="copy-btn" data-copy="${escapeHtml(dropCmd)}">Copy drop command</button>`,
    `<button class="copy-btn" data-copy="${escapeHtml(opts.branch)}">Copy branch</button>`,
    `</div>`,
  ].join('');
}

function toFileHref(p: string): string {
  if (!p) return '';
  if (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('file:')) return p;
  if (!path.isAbsolute(p)) return p.split(path.sep).join('/');
  const norm = p.replace(/\\/g, '/');
  return norm.startsWith('/') ? `file://${norm}` : `file:///${norm}`;
}

function formatDurationShort(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

// ── Module-mapping defaults (one-shot writer) ─────────────────────────────

function defaultModuleOf(result: EnhanceFlowResult): (file: string) => string[] {
  const logFiles = new Set(result.modules.logExecutor?.filesChanged ?? []);
  const bugFiles = new Set(
    (result.modules.bugPatcher ?? [])
      .filter((p) => p.status === 'applied')
      .map((p) => p.finding.file),
  );
  const healthFile = result.modules.healthGen?.added ?? null;
  const sentryFiles = new Set(result.modules.sentryInstaller?.added ?? []);
  const sentryDeps = (result.modules.sentryInstaller?.dependencies ?? []).length > 0;
  return (file: string): string[] => {
    const m: string[] = [];
    if (logFiles.has(file)) m.push('logging');
    if (bugFiles.has(file)) m.push('bug-patcher');
    if (healthFile && file === healthFile) m.push('health');
    if (sentryFiles.has(file)) m.push('sentry');
    if (sentryDeps && (file === 'package.json' || file.endsWith('/package.json'))) m.push('sentry');
    if (file === '.env.example' || file.endsWith('/.env.example')) m.push('env');
    if (m.length === 0) m.push('other');
    return m;
  };
}

function defaultReasonOf(result: EnhanceFlowResult): (file: string) => string | undefined {
  const plan = result.modules.logPlanner;
  const sitesByFile = new Map<string, string[]>();
  if (plan) {
    for (const s of plan.sites) {
      const list = sitesByFile.get(s.file) ?? [];
      list.push(s.kind);
      sitesByFile.set(s.file, list);
    }
  }
  return (file: string): string | undefined => {
    const kinds = sitesByFile.get(file);
    if (kinds && kinds.length > 0) {
      return `log injection sites: ${Array.from(new Set(kinds)).join(', ')}`;
    }
    return undefined;
  };
}

// ── Splice helper ────────────────────────────────────────────────────────

/**
 * Replace the slice of `html` between `startMarker` and `endMarker`
 * (markers preserved) with the result of `fn(currentInner)`.
 * Throws if either marker is missing — that's a programmer error in the
 * caller, not something we can recover from silently.
 */
export function spliceBetween(
  html: string,
  startMarker: string,
  endMarker: string,
  fn: (inner: string) => string,
): string {
  const s = html.indexOf(startMarker);
  const e = html.indexOf(endMarker);
  if (s < 0 || e < 0 || e < s) {
    throw new Error(`spliceBetween: markers not found (${startMarker} … ${endMarker})`);
  }
  const before = html.slice(0, s + startMarker.length);
  const after = html.slice(e);
  return before + fn(html.slice(s + startMarker.length, e)) + after;
}

// ── Test exports ──────────────────────────────────────────────────────────

export const __htmlInternals = {
  renderSkeleton,
  renderSummaryStats,
  renderNavChips,
  renderFileRow,
  renderFindingRow,
  renderFindingsBody,
  renderVerifyBlock,
  renderFooter,
  renderHotkeyOverlay,
  defaultModuleOf,
  defaultReasonOf,
  toFileHref,
  formatDurationShort,
  moduleFriendlyName,
  verdictForFile,
  isLockfile,
  buildFindingRows,
};
