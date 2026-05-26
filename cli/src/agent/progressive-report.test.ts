/**
 * Tests for agent/progressive-report.ts (Phase 8 Track 8D).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ProgressiveReportWriter,
  type ReportSummary,
  formatDuration,
  SECTION_ORDER,
} from './progressive-report.js';
import {
  createTrackLogger,
  captureLogsFor,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../log-types.js';

let tmpDir: string;

beforeEach(async () => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zerou-report-'));
});

afterEach(async () => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    /* swallow */
  }
});

function makeWriter(name = 'demo'): {
  writer: ProgressiveReportWriter;
  reportPath: string;
} {
  const reportPath = path.join(tmpDir, '.zerou', 'audit-report.md');
  const logger = createTrackLogger('agent');
  const writer = new ProgressiveReportWriter({
    reportPath,
    logger,
    projectName: name,
  });
  return { writer, reportPath };
}

function makeSummary(overrides: Partial<ReportSummary> = {}): ReportSummary {
  return {
    status: 'completed',
    durationMs: 12345,
    categories: 2,
    findings: { total: 3, confirmed: 2, falsePositive: 1, needsContext: 0 },
    tests: { total: 6, pass: 5, fail: 1, skipped: 0 },
    coverage: { linePct: 67, branchPct: 52 },
    ...overrides,
  };
}

describe('formatDuration', () => {
  it('formats sub-minute as seconds', () => {
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(0)).toBe('0s');
  });

  it('formats minute+seconds', () => {
    expect(formatDuration(65_000)).toBe('1m 5s');
    expect(formatDuration(754_000)).toBe('12m 34s');
  });

  it('handles negative / NaN safely', () => {
    expect(formatDuration(-1)).toBe('0s');
    expect(formatDuration(NaN)).toBe('0s');
  });
});

describe('ProgressiveReportWriter — initialization', () => {
  it('creates parent directory and writes initial template', async () => {
    const { writer, reportPath } = makeWriter('my-demo');
    // Force chain to flush by performing one no-op-ish task.
    await writer.appendSection('profile', 'Project Profile', '- nothing yet');

    const content = await fs.readFile(reportPath, 'utf8');
    expect(content).toContain('# ZeroU Audit Report');
    expect(content).toContain('**Project**: my-demo');
    expect(content).toContain('**Status**: 🔄 running');
  });

  it('uses path basename as default project name', async () => {
    const reportPath = path.join(tmpDir, 'reportdir', 'audit-report.md');
    const logger = createTrackLogger('agent');
    const writer = new ProgressiveReportWriter({ reportPath, logger });
    await writer.appendSection('profile', 'Project Profile', 'x');

    const content = await fs.readFile(reportPath, 'utf8');
    expect(content).toContain('**Project**: reportdir');
  });
});

describe('ProgressiveReportWriter — appendSection', () => {
  it('writes section with start/end markers and a numbered heading', async () => {
    const { writer, reportPath } = makeWriter();
    await writer.appendSection('profile', 'Project Profile', '- Framework: Next.js');

    const content = await fs.readFile(reportPath, 'utf8');
    expect(content).toContain('<!-- section:profile start -->');
    expect(content).toContain('<!-- section:profile end -->');
    expect(content).toMatch(/## 1\. Project Profile/);
    expect(content).toContain('- Framework: Next.js');
  });

  it('renders sections in canonical SECTION_ORDER regardless of append order', async () => {
    const { writer, reportPath } = makeWriter();
    // Append out of order.
    await writer.appendSection('coverage', 'Coverage', 'cov body');
    await writer.appendSection('profile', 'Project Profile', 'profile body');
    await writer.appendSection('checklist', 'Audit Checklist', 'checklist body');

    const content = await fs.readFile(reportPath, 'utf8');
    const profileIdx = content.indexOf('profile body');
    const checklistIdx = content.indexOf('checklist body');
    const coverageIdx = content.indexOf('cov body');
    expect(profileIdx).toBeGreaterThan(0);
    expect(checklistIdx).toBeGreaterThan(profileIdx);
    expect(coverageIdx).toBeGreaterThan(checklistIdx);

    // Numbering follows canonical order: profile=1, checklist=2, coverage=7.
    expect(content).toMatch(/## 1\. Project Profile/);
    expect(content).toMatch(/## 2\. Audit Checklist/);
    expect(content).toMatch(/## 7\. Coverage/);
  });

  it('overwrites + warns when same section id appended twice', async () => {
    const localPath = path.join(tmpDir, 'log-test', 'audit-report.md');
    const { entries } = await captureLogsFor(
      { track: 'agent' },
      async () => {
        const logger = createTrackLogger('agent');
        const w = new ProgressiveReportWriter({
          reportPath: localPath,
          logger,
          projectName: 'lt',
        });
        await w.appendSection('profile', 'Project Profile', 'first');
        await w.appendSection('profile', 'Project Profile', 'second');
      },
    );

    const content = await fs.readFile(localPath, 'utf8');
    expect(content).toContain('second');
    expect(content).not.toContain('first');

    const overwriteLog = entries.find(
      (e) =>
        e.event === 'agent.report.section-append-decision' &&
        (e as Record<string, unknown>).decision === 'overwrite-existing',
    );
    expect(overwriteLog).toBeTruthy();
  });

  it('rejects unknown section ids', async () => {
    const { writer } = makeWriter();
    // First make sure constructor write resolved.
    await writer.appendSection('profile', 'Project Profile', 'x');
    await expect(
      // @ts-expect-error intentional bad input
      writer.appendSection('not-a-section', 'X', 'body'),
    ).rejects.toThrow(/Unknown section/);
  });
});

describe('ProgressiveReportWriter — updateSection', () => {
  it('replaces only the body between markers', async () => {
    const { writer, reportPath } = makeWriter();
    await writer.appendSection('profile', 'Project Profile', 'OLD CONTENT');
    await writer.appendSection('checklist', 'Audit Checklist', 'CHECKLIST CONTENT');
    await writer.updateSection('profile', 'NEW CONTENT');

    const content = await fs.readFile(reportPath, 'utf8');
    expect(content).toContain('NEW CONTENT');
    expect(content).not.toContain('OLD CONTENT');
    // Other section untouched.
    expect(content).toContain('CHECKLIST CONTENT');
  });

  it('is a no-op when section does not exist', async () => {
    const { writer, reportPath } = makeWriter();
    await writer.appendSection('profile', 'Project Profile', 'x');
    // Should not throw, should not add a new section.
    await writer.updateSection('coverage', 'should not appear');

    const content = await fs.readFile(reportPath, 'utf8');
    expect(content).not.toContain('should not appear');
    expect(content).not.toContain('section:coverage');
  });
});

describe('ProgressiveReportWriter — finalize', () => {
  it('switches status from running to completed and inserts TOC + Summary', async () => {
    const { writer, reportPath } = makeWriter('finalize-demo');
    await writer.appendSection('profile', 'Project Profile', 'p');
    await writer.appendSection('checklist', 'Audit Checklist', 'c');
    await writer.appendSection('test-execution', 'Test Execution', 't');

    await writer.finalize(makeSummary());

    const content = await fs.readFile(reportPath, 'utf8');
    expect(content).toContain('**Status**: ✅ completed (12s)');
    expect(content).toContain('## Summary');
    expect(content).toContain('- **Categories scanned**: 2');
    expect(content).toContain(
      '- **Findings**: 3 total (2 confirmed, 1 false-positive, 0 needs-context)',
    );
    expect(content).toContain(
      '- **Tests**: 6 total (5 passed, 1 failed, 0 skipped)',
    );
    expect(content).toContain('- **Coverage**: line 67% / branch 52%');
    expect(content).toContain('## Table of Contents');
    // TOC uses sequential display indexes for presence.
    expect(content).toMatch(/1\. \[Project Profile\]/);
    expect(content).toMatch(/2\. \[Audit Checklist\]/);
    expect(content).toMatch(/3\. \[Test Execution\]/);
    // Section headings themselves use canonical (positional) numbers:
    // profile=1, checklist=2, test-execution=6.
    expect(content).toMatch(/## 1\. Project Profile/);
    expect(content).toMatch(/## 2\. Audit Checklist/);
    expect(content).toMatch(/## 6\. Test Execution/);
    // Running-mode placeholder line is gone.
    expect(content).not.toContain('Tail this file');
  });

  it('handles failed status without coverage', async () => {
    const { writer, reportPath } = makeWriter();
    await writer.appendSection('profile', 'Project Profile', 'p');
    await writer.finalize(
      makeSummary({
        status: 'failed',
        durationMs: 754_000,
        coverage: undefined,
      }),
    );

    const content = await fs.readFile(reportPath, 'utf8');
    expect(content).toContain('**Status**: ❌ failed (12m 34s)');
    expect(content).not.toContain('**Coverage**:');
  });
});

describe('ProgressiveReportWriter — concurrency', () => {
  it('serializes concurrent appendSection calls without interleaving', async () => {
    const { writer, reportPath } = makeWriter();

    // Fire all 8 sections concurrently (no awaits between them).
    const promises = SECTION_ORDER.map((id, i) =>
      writer.appendSection(id, `Title ${i}`, `body for ${id}`),
    );
    await Promise.all(promises);

    const content = await fs.readFile(reportPath, 'utf8');
    // All 8 markers present.
    for (const id of SECTION_ORDER) {
      expect(content).toContain(`<!-- section:${id} start -->`);
      expect(content).toContain(`<!-- section:${id} end -->`);
    }
    // Order in file matches canonical order.
    let lastIdx = -1;
    for (const id of SECTION_ORDER) {
      const idx = content.indexOf(`<!-- section:${id} start -->`);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it('finalize after burst of appends sees all sections', async () => {
    const { writer, reportPath } = makeWriter();
    const ps = [
      writer.appendSection('profile', 'Project Profile', 'p'),
      writer.appendSection('checklist', 'Audit Checklist', 'c'),
      writer.appendSection('coverage', 'Coverage', 'cov'),
    ];
    // Don't await; chain finalize too.
    const fin = writer.finalize(makeSummary());
    await Promise.all([...ps, fin]);

    const content = await fs.readFile(reportPath, 'utf8');
    expect(content).toContain('## Summary');
    expect(content).toContain('## Table of Contents');
    expect(content).toContain('## 1. Project Profile');
    expect(content).toContain('## 2. Audit Checklist');
    // coverage is canonical position 7
    expect(content).toContain('## 7. Coverage');
  });
});

describe('ProgressiveReportWriter — logging events', () => {
  it('emits section-appended events with totalLength', async () => {
    const reportPath = path.join(tmpDir, 'log2', 'audit-report.md');
    const { entries } = await captureLogsFor({ track: 'agent' }, async () => {
      const logger = createTrackLogger('agent');
      const w = new ProgressiveReportWriter({
        reportPath,
        logger,
        projectName: 'lt',
      });
      await w.appendSection('profile', 'Project Profile', 'body');
    });

    const appended = entries.find(
      (e) => e.event === 'agent.report.section-appended',
    );
    expect(appended).toBeTruthy();
    const ad = appended as unknown as Record<string, unknown>;
    expect(ad.id).toBe('profile');
    expect(ad.totalLength as number).toBeGreaterThan(0);
  });

  it('emits finalized event with summary fields', async () => {
    const reportPath = path.join(tmpDir, 'log3', 'audit-report.md');
    const { entries } = await captureLogsFor({ track: 'agent' }, async () => {
      const logger = createTrackLogger('agent');
      const w = new ProgressiveReportWriter({
        reportPath,
        logger,
        projectName: 'lt',
      });
      await w.appendSection('profile', 'Project Profile', 'b');
      await w.finalize(makeSummary());
    });

    const fin = entries.find((e) => e.event === 'agent.report.finalized');
    expect(fin).toBeTruthy();
    const data = fin as unknown as Record<string, unknown>;
    expect(data.status).toBe('completed');
    expect(data.sectionCount).toBe(1);
    expect(data.durationMs).toBe(12345);
    expect(data.totalSize as number).toBeGreaterThan(0);
  });
});
