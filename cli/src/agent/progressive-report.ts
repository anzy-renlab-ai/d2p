/**
 * Progressive audit-report.md writer (Phase 8 Track 8D).
 *
 * Streams a structured markdown report to disk as the audit runs so the
 * user can `tail -f .zerou/audit-report.md` and watch progress.
 *
 * Surface contract: docs/plans/2026-05-26-phase-8-real-tests-progressive-report.md
 *                   §"agent/progressive-report.ts (Track 8D)"
 *
 * Design notes:
 * - Sections are written in a fixed canonical order (numbered 1..8) but the
 *   caller may `appendSection` them in any order; they always render in
 *   canonical order in the file.
 * - Each section is delimited by HTML comments so `updateSection` can rewrite
 *   only that span without touching neighbours.
 * - All disk writes are serialized through an internal promise chain so
 *   concurrent callers cannot interleave.
 * - All logging goes through `logBranch` and is fail-safe.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import type { TrackLogger } from '../log-types.js';
import { logBranch, logCatch } from '../log/branch.js';

export type SectionId =
  | 'profile'
  | 'checklist'
  | 'static-findings'
  | 'verdicts'
  | 'test-suite'
  | 'test-execution'
  | 'coverage'
  | 'action-items';

const SECTION_ORDER: SectionId[] = [
  'profile',
  'checklist',
  'static-findings',
  'verdicts',
  'test-suite',
  'test-execution',
  'coverage',
  'action-items',
];

const DEFAULT_TITLES: Record<SectionId, string> = {
  profile: 'Project Profile',
  checklist: 'Audit Checklist',
  'static-findings': 'Static Findings',
  verdicts: 'Verdicts',
  'test-suite': 'Test Suite',
  'test-execution': 'Test Execution',
  coverage: 'Coverage',
  'action-items': 'Action Items',
};

const RUNNING_STATUS = '🔄 running';

export interface ReportSummary {
  status: 'completed' | 'failed' | 'partial';
  durationMs: number;
  categories: number;
  findings: {
    total: number;
    confirmed: number;
    falsePositive: number;
    needsContext: number;
  };
  tests: {
    total: number;
    pass: number;
    fail: number;
    skipped: number;
  };
  coverage?: {
    linePct: number;
    branchPct: number;
  };
}

export interface ProgressiveReportWriterOptions {
  reportPath: string;
  logger: TrackLogger;
  projectName?: string;
}

interface SectionState {
  title: string;
  body: string;
}

/**
 * Stream-writes an audit-report.md to disk as the audit progresses.
 *
 * Caller pattern:
 *   const w = new ProgressiveReportWriter({ reportPath, logger, projectName });
 *   await w.appendSection('profile', 'Project Profile', body);
 *   await w.appendSection('checklist', 'Audit Checklist', body);
 *   ...
 *   await w.finalize({ status: 'completed', ... });
 */
export class ProgressiveReportWriter {
  private readonly reportPath: string;
  private readonly logger: TrackLogger;
  private readonly projectName: string;
  private readonly generatedAt: string;

  private readonly sections = new Map<SectionId, SectionState>();
  private status: string = RUNNING_STATUS;
  private finalized = false;
  private finalSummary: ReportSummary | null = null;
  private finalToc = false;

  // Serializes all disk I/O so concurrent appendSection/updateSection cannot
  // interleave reads/writes on the same file.
  private writeChain: Promise<void> = Promise.resolve();

  constructor(opts: ProgressiveReportWriterOptions) {
    this.reportPath = opts.reportPath;
    this.logger = opts.logger;
    this.projectName =
      opts.projectName ?? path.basename(path.dirname(opts.reportPath)) ?? 'unknown';
    this.generatedAt = new Date().toISOString();

    // Kick off the initial write immediately so any subsequent appendSection
    // is guaranteed to see the file exist. We append to the chain so that
    // even constructor-init failures are surfaced through the chain.
    this.writeChain = this.writeChain
      .then(() => this.writeInitial())
      .catch((err) => {
        logCatch(this.logger, 'agent.report.init-failed', err, {
          reportPath: this.reportPath,
        });
        // Re-throw so callers awaiting the chain see the failure.
        throw err;
      });
  }

  /**
   * Append (or overwrite) a section by id. If the section already exists,
   * the new content overwrites it and a warn-level branch log is emitted.
   *
   * Sections always render in canonical SECTION_ORDER regardless of append
   * order.
   */
  appendSection(id: SectionId, title: string, markdown: string): Promise<void> {
    return this.enqueue(async () => {
      if (!SECTION_ORDER.includes(id)) {
        logBranch(this.logger, 'agent.report.section-append-decision', {
          decision: 'reject-unknown-id',
          id,
        });
        throw new Error(`Unknown section id: ${id}`);
      }

      const isOverwrite = this.sections.has(id);
      this.sections.set(id, { title, body: markdown });

      if (isOverwrite) {
        logBranch(
          this.logger,
          'agent.report.section-append-decision',
          {
            decision: 'overwrite-existing',
            id,
          },
          { level: 'info' },
        );
      }

      await this.rewriteFile();

      const totalLength = await this.fileLengthSafe();
      logBranch(
        this.logger,
        'agent.report.section-appended',
        {
          decision: 'appended',
          id,
          title,
          totalLength,
        },
        { level: 'info' },
      );
    });
  }

  /**
   * Update an existing section's body. If the section doesn't exist this is
   * a no-op (logged at warn level).
   */
  updateSection(id: SectionId, markdown: string): Promise<void> {
    return this.enqueue(async () => {
      const existing = this.sections.get(id);
      if (!existing) {
        logBranch(
          this.logger,
          'agent.report.section-update-decision',
          {
            decision: 'no-op-missing-section',
            id,
          },
          { level: 'info' },
        );
        return;
      }

      this.sections.set(id, { title: existing.title, body: markdown });
      await this.rewriteFile();

      logBranch(
        this.logger,
        'agent.report.section-updated',
        {
          decision: 'updated',
          id,
        },
        { level: 'info' },
      );
    });
  }

  /**
   * Mark the report complete: rewrite header status + insert Summary block
   * + insert Table of Contents (after Summary, before sections).
   *
   * Safe to call multiple times — subsequent calls just rewrite with the
   * latest summary.
   */
  finalize(summary: ReportSummary): Promise<void> {
    return this.enqueue(async () => {
      this.finalSummary = summary;
      this.finalToc = true;
      this.finalized = true;
      this.status = formatStatus(summary);

      await this.rewriteFile();

      let totalSize = 0;
      try {
        const stat = await fs.stat(this.reportPath);
        totalSize = stat.size;
      } catch {
        totalSize = 0;
      }

      logBranch(
        this.logger,
        'agent.report.finalized',
        {
          decision: 'finalized',
          status: summary.status,
          totalSize,
          sectionCount: this.sections.size,
          durationMs: summary.durationMs,
        },
        { level: 'info' },
      );
    });
  }

  // --------------------------------------------------------------------- //
  // Internals
  // --------------------------------------------------------------------- //

  /** Enqueue a task on the serial write chain. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    let resolver!: (value: T | PromiseLike<T>) => void;
    let rejecter!: (reason?: unknown) => void;
    const outcome = new Promise<T>((res, rej) => {
      resolver = res;
      rejecter = rej;
    });

    this.writeChain = this.writeChain.then(async () => {
      try {
        const v = await task();
        resolver(v);
      } catch (err) {
        rejecter(err);
        // Do NOT propagate to chain — one failure shouldn't poison everyone.
      }
    });

    return outcome;
  }

  private async writeInitial(): Promise<void> {
    const dir = path.dirname(this.reportPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.reportPath, this.renderDocument(), 'utf8');
  }

  private async rewriteFile(): Promise<void> {
    const content = this.renderDocument();
    await fs.writeFile(this.reportPath, content, 'utf8');
  }

  private async fileLengthSafe(): Promise<number> {
    try {
      const stat = await fs.stat(this.reportPath);
      return stat.size;
    } catch {
      return 0;
    }
  }

  /** Render the whole document from current state. Deterministic. */
  private renderDocument(): string {
    const out: string[] = [];

    out.push('# ZeroU Audit Report');
    out.push('');
    out.push(`**Project**: ${this.projectName}`);
    out.push(`**Generated**: ${this.generatedAt}`);
    out.push(`**Status**: ${this.status}`);
    out.push('');
    out.push('---');
    out.push('');

    if (this.finalSummary) {
      out.push('## Summary');
      out.push('');
      out.push(...renderSummaryLines(this.finalSummary));
      out.push('');
    }

    if (this.finalToc && this.sections.size > 0) {
      out.push('## Table of Contents');
      out.push('');
      let displayIdx = 0;
      for (let i = 0; i < SECTION_ORDER.length; i += 1) {
        const id = SECTION_ORDER[i]!;
        const sec = this.sections.get(id);
        if (!sec) continue;
        displayIdx += 1;
        const n = i + 1; // canonical fixed number
        const anchor = slugifyAnchor(`${n}-${sec.title}`);
        out.push(`${displayIdx}. [${sec.title}](#${anchor})`);
      }
      out.push('');
    }

    if (!this.finalized) {
      out.push('<!-- Sections will be appended below as the audit progresses -->');
      out.push('<!-- Tail this file: tail -f .zerou/audit-report.md -->');
      out.push('');
    }

    // Render sections in canonical order with fixed positional numbers.
    for (let i = 0; i < SECTION_ORDER.length; i += 1) {
      const id = SECTION_ORDER[i]!;
      const sec = this.sections.get(id);
      if (!sec) continue;
      const n = i + 1; // canonical fixed number
      out.push(`<!-- section:${id} start -->`);
      out.push(`## ${n}. ${sec.title}`);
      out.push('');
      out.push(sec.body);
      out.push('');
      out.push(`<!-- section:${id} end -->`);
      out.push('');
    }

    return out.join('\n');
  }
}

// ------------------------------------------------------------------------- //
// Pure helpers (exported for tests)
// ------------------------------------------------------------------------- //

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatStatus(summary: ReportSummary): string {
  const icon =
    summary.status === 'completed' ? '✅' : summary.status === 'failed' ? '❌' : '⚠️';
  return `${icon} ${summary.status} (${formatDuration(summary.durationMs)})`;
}

function renderSummaryLines(s: ReportSummary): string[] {
  const lines: string[] = [];
  lines.push(`- **Duration**: ${formatDuration(s.durationMs)}`);
  lines.push(`- **Categories scanned**: ${s.categories}`);
  lines.push(
    `- **Findings**: ${s.findings.total} total ` +
      `(${s.findings.confirmed} confirmed, ` +
      `${s.findings.falsePositive} false-positive, ` +
      `${s.findings.needsContext} needs-context)`,
  );
  lines.push(
    `- **Tests**: ${s.tests.total} total ` +
      `(${s.tests.pass} passed, ${s.tests.fail} failed, ${s.tests.skipped} skipped)`,
  );
  if (s.coverage) {
    lines.push(
      `- **Coverage**: line ${s.coverage.linePct}% / branch ${s.coverage.branchPct}%`,
    );
  }
  return lines;
}

function slugifyAnchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// Re-export for convenience (Lead may want default titles).
export { DEFAULT_TITLES, SECTION_ORDER };
