/**
 * Phase 11 — single-file HTML enhance report.
 *
 * Emits one self-contained HTML file with inlined CSS + JS. Append-friendly:
 *
 *   const writer = new HtmlReportWriter({...});
 *   await writer.writeSkeleton();          // status="running", meta refresh on
 *   await writer.appendFileChange(...);    // streamed in as modules complete
 *   await writer.setVerify(verifyResult);
 *   await writer.finalize(durationMs);     // status="pass"/"fail", refresh off
 *
 * The skeleton contains marker comments so subsequent appends know exactly
 * where to splice. This avoids parsing HTML — we just match strings.
 *
 * Authority: D:\lll\d2p\docs\reviews\2026-05-27-presentation-layer.md
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { renderDiffHtml, escapeHtml } from './html-diff.js';
import { REPORT_CSS, REPORT_JS } from './html-assets.js';
import type { TrackLogger } from '../log-types.js';
import type {
  FileDiff,
  EnhanceFlowResult,
  VerifyResult,
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
  verifyStart: '<!--ZEROU:VERIFY_START-->',
  verifyEnd: '<!--ZEROU:VERIFY_END-->',
  footerStart: '<!--ZEROU:FOOTER_START-->',
  footerEnd: '<!--ZEROU:FOOTER_END-->',
  refreshStart: '<!--ZEROU:REFRESH_START-->',
  refreshEnd: '<!--ZEROU:REFRESH_END-->',
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
   * Append a per-file change article. Splices between CHANGES_START and
   * CHANGES_END markers. Updates module-count nav chips.
   */
  async appendFileChange(input: FileChangeInput): Promise<void> {
    const article = renderFileArticle(input);

    // Update counters.
    this.fileCount++;
    this.additions += input.additions;
    this.deletions += input.deletions;
    for (const m of input.modules.length > 0 ? input.modules : ['other']) {
      this.moduleCounts.set(m, (this.moduleCounts.get(m) ?? 0) + 1);
    }

    let html = await fs.readFile(this.reportPath, 'utf8');
    html = spliceBetween(html, HTML_MARKERS.changesStart, HTML_MARKERS.changesEnd, (inner) => {
      // Strip any "empty" placeholder when the first article arrives.
      const cleaned = inner.replace(/<div class="empty">[^<]*<\/div>/i, '');
      return cleaned + '\n' + article;
    });
    html = spliceBetween(html, HTML_MARKERS.navStart, HTML_MARKERS.navEnd, () =>
      renderNavChips(this.moduleCounts, this.fileCount),
    );
    html = spliceBetween(html, HTML_MARKERS.summaryStart, HTML_MARKERS.summaryEnd, () =>
      renderSummaryStats(this.fileCount, this.additions, this.deletions, this.verifyResult),
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

  /** Record the verify result so the summary + finalize reflect it. */
  async setVerify(verify: VerifyResult): Promise<void> {
    this.verifyResult = verify;
    let html = await fs.readFile(this.reportPath, 'utf8');
    html = spliceBetween(html, HTML_MARKERS.verifyStart, HTML_MARKERS.verifyEnd, () =>
      renderVerifyBlock(verify),
    );
    html = spliceBetween(html, HTML_MARKERS.summaryStart, HTML_MARKERS.summaryEnd, () =>
      renderSummaryStats(this.fileCount, this.additions, this.deletions, verify),
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
        ? 'Done — verify passed'
        : 'Done — verify failed'
      : 'Done';
    const statusClass = ok ? 'status-pass' : 'status-fail';

    html = spliceBetween(html, HTML_MARKERS.headStatusStart, HTML_MARKERS.headStatusEnd, () =>
      `<span class="${statusClass}">${escapeHtml(statusLabel)}</span>`,
    );
    html = spliceBetween(html, HTML_MARKERS.refreshStart, HTML_MARKERS.refreshEnd, () => '');
    html = spliceBetween(html, HTML_MARKERS.footerStart, HTML_MARKERS.footerEnd, () =>
      renderFooter({
        durationMs,
        statusLabel,
        markdownPath: this.markdownPath,
        worktree: this.worktree,
      }),
    );

    if (this.fileCount === 0) {
      html = spliceBetween(html, HTML_MARKERS.changesStart, HTML_MARKERS.changesEnd, () =>
        '\n<div class="empty">No file changes detected between main and HEAD.</div>\n',
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
  } {
    return {
      fileCount: this.fileCount,
      additions: this.additions,
      deletions: this.deletions,
      finalized: this.finalized,
      moduleCounts: this.moduleCounts,
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
  if (opts.result.verify) await writer.setVerify(opts.result.verify);
  await writer.finalize(opts.result.durationMs);
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
  const mergeCmd = `git merge --no-ff ${opts.branch}`;
  const dropCmd = `git worktree remove ${opts.worktree}`;
  const refreshMeta = opts.running ? '<meta http-equiv="refresh" content="2">' : '';
  return [
    '<!doctype html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `${HTML_MARKERS.refreshStart}${refreshMeta}${HTML_MARKERS.refreshEnd}`,
    `<style>${REPORT_CSS}</style>`,
    '</head><body>',
    '<header class="sticky">',
    '<div>',
    `<h1>${escapeHtml(title)}</h1>`,
    `<div class="branch">branch: ${escapeHtml(opts.branch)} · ${HTML_MARKERS.headStatusStart}<span class="status-running">Running…</span>${HTML_MARKERS.headStatusEnd}</div>`,
    '</div>',
    '<div class="actions">',
    `<button class="copy-btn" data-copy="${escapeHtml(mergeCmd)}">Copy merge command</button>`,
    `<button class="copy-btn" data-copy="${escapeHtml(dropCmd)}">Copy drop command</button>`,
    `<button class="copy-btn" data-copy="${escapeHtml(opts.branch)}">Copy branch</button>`,
    '</div>',
    '</header>',
    `<section class="summary">${HTML_MARKERS.summaryStart}${renderSummaryStats(0, 0, 0, null)}${HTML_MARKERS.summaryEnd}</section>`,
    `<nav class="module-filter">${HTML_MARKERS.navStart}${renderNavChips(new Map(), 0)}${HTML_MARKERS.navEnd}</nav>`,
    `<main class="changes">${HTML_MARKERS.changesStart}\n<div class="empty">Running… changes will appear here as modules complete.</div>\n${HTML_MARKERS.changesEnd}</main>`,
    `<section class="verify">${HTML_MARKERS.verifyStart}${HTML_MARKERS.verifyEnd}</section>`,
    `<footer>${HTML_MARKERS.footerStart}${renderFooter({ durationMs: 0, statusLabel: 'Running…', markdownPath: opts.markdownPath, worktree: opts.worktree })}${HTML_MARKERS.footerEnd}</footer>`,
    `<script>${REPORT_JS}</script>`,
    '</body></html>',
  ].join('\n');
}

// ── Section renderers ─────────────────────────────────────────────────────

function renderSummaryStats(
  files: number,
  additions: number,
  deletions: number,
  verify: VerifyResult | null,
): string {
  const verifyLabel = verify
    ? verify.ok
      ? '<span class="status-pass">✅ verify passed</span>'
      : '<span class="status-fail">❌ verify failed</span>'
    : '<span class="status-running">⏳ verify pending</span>';
  return [
    `<div class="stat">📁 ${files} file${files === 1 ? '' : 's'}</div>`,
    `<div class="stat">📈 +${additions} / -${deletions}</div>`,
    `<div class="stat">${verifyLabel}</div>`,
  ].join('');
}

function renderNavChips(counts: Map<string, number>, total: number): string {
  const allLabel = `All ${total}`;
  const parts: string[] = [
    `<button class="filter-btn" data-module="__all__" aria-pressed="true">${escapeHtml(allLabel)}</button>`,
  ];
  // Stable sort by module id so the chip order doesn't reflow run-to-run.
  const sorted = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [mod, n] of sorted) {
    const friendly = moduleFriendlyName(mod);
    parts.push(
      `<button class="filter-btn" data-module="${escapeHtml(mod)}" aria-pressed="false">${escapeHtml(friendly)} ${n}</button>`,
    );
  }
  return parts.join('');
}

function moduleFriendlyName(id: string): string {
  switch (id) {
    case 'logging': return '📝 Logging';
    case 'log-injection': return '📝 Logging';
    case 'bug-patcher': return '🐛 Bug fix';
    case 'bugs': return '🐛 Bug fix';
    case 'health': return '🏥 Health';
    case 'sentry': return '🚨 Sentry';
    case 'env': return '🔧 .env';
    case 'other': return '📦 Other';
    default: return id;
  }
}

function renderFileArticle(input: FileChangeInput): string {
  const statusBadge = input.status === 'added'
    ? '<span class="badge added">new</span>'
    : input.status === 'deleted'
      ? '<span class="badge removed">deleted</span>'
      : input.status === 'renamed'
        ? '<span class="badge">renamed</span>'
        : '';
  const counts = `<span class="badge">+${input.additions} / -${input.deletions}</span>`;
  const renameNote = input.status === 'renamed' && input.oldFile
    ? ` <span class="badge">from ${escapeHtml(input.oldFile)}</span>`
    : '';
  const modulesAttr = (input.modules.length > 0 ? input.modules : ['other']).join(',');
  const why = input.decisionReason
    ? `<p class="why">💡 Why ZeroU did this: ${escapeHtml(input.decisionReason)}</p>`
    : '';
  const body = input.omittedReason
    ? `<div class="omitted">Diff omitted: ${escapeHtml(input.omittedReason)}</div>`
    : renderDiffHtml(input.unifiedDiff);
  return [
    `<article class="file-change" data-file="${escapeHtml(input.file)}" data-modules="${escapeHtml(modulesAttr)}">`,
    `<h2>${escapeHtml(input.file)} ${statusBadge} ${counts}${renameNote}</h2>`,
    why,
    body,
    '</article>',
  ].join('\n');
}

function renderVerifyBlock(verify: VerifyResult): string {
  const rows: string[] = [];
  rows.push(
    '<h2 style="padding:0 20px;">Verify</h2>',
    '<div style="padding:0 20px 20px;">',
    '<table style="border-collapse:collapse;width:100%;font-size:13px;">',
    '<thead><tr><th style="text-align:left;border-bottom:1px solid var(--border);padding:6px;">Step</th><th style="text-align:left;border-bottom:1px solid var(--border);padding:6px;">Status</th><th style="text-align:right;border-bottom:1px solid var(--border);padding:6px;">Duration</th></tr></thead>',
    '<tbody>',
  );
  for (const step of verify.steps) {
    const glyph = step.status === 'pass' ? '✅' : step.status === 'fail' ? '❌' : '➖';
    const cls = step.status === 'pass' ? 'status-pass' : step.status === 'fail' ? 'status-fail' : '';
    rows.push(
      `<tr><td style="padding:6px;font-family:var(--code-font);">${escapeHtml(step.name)}</td>` +
        `<td class="${cls}" style="padding:6px;">${glyph} ${escapeHtml(step.status)}</td>` +
        `<td style="text-align:right;padding:6px;">${formatDurationShort(step.durationMs)}</td></tr>`,
    );
  }
  rows.push('</tbody></table>');
  if (!verify.ok && verify.brokenBy) {
    rows.push(`<p style="color:var(--bad);">Broken by: ${escapeHtml(verify.brokenBy)}</p>`);
  }
  rows.push('</div>');
  return rows.join('\n');
}

interface FooterOpts {
  durationMs: number;
  statusLabel: string;
  markdownPath: string;
  worktree: string;
}

function renderFooter(opts: FooterOpts): string {
  const duration = formatDurationShort(opts.durationMs);
  const mdHref = toFileHref(opts.markdownPath);
  return [
    `Generated by ZeroU · duration ${escapeHtml(duration)} · status ${escapeHtml(opts.statusLabel)}`,
    '· ',
    `<a href="${escapeHtml(mdHref)}">markdown report</a>`,
    `· worktree <code>${escapeHtml(opts.worktree)}</code>`,
  ].join(' ');
}

function toFileHref(p: string): string {
  if (!p) return '';
  if (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('file:')) return p;
  // Relative paths stay relative so they resolve next to the HTML.
  if (!path.isAbsolute(p)) return p.split(path.sep).join('/');
  // Windows: D:\a\b → file:///D:/a/b ; POSIX: /a/b → file:///a/b
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
      return `Log injection sites: ${Array.from(new Set(kinds)).join(', ')}`;
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
  const inner = html.slice(s + startMarker.length, e);
  const after = html.slice(e);
  return before + fn(inner) + after;
}

// ── Test exports ──────────────────────────────────────────────────────────

export const __htmlInternals = {
  renderSkeleton,
  renderSummaryStats,
  renderNavChips,
  renderFileArticle,
  renderVerifyBlock,
  renderFooter,
  defaultModuleOf,
  defaultReasonOf,
  toFileHref,
  formatDurationShort,
  moduleFriendlyName,
};
