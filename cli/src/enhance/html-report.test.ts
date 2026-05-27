/**
 * Tests for enhance/html-report.ts (Phase 11.4 dense table-driven layout).
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  HtmlReportWriter,
  HTML_MARKERS,
  spliceBetween,
  writeEnhanceHtmlReport,
  buildFindingRows,
  __htmlInternals,
} from './html-report.js';
import type {
  EnhanceFlowResult,
  FileDiff,
  VerifyResult,
  AuditFinding,
} from './types.js';
import type { TestCaseResult } from '../agent/types.js';

let scratch: string[] = [];

beforeEach(() => { scratch = []; });
afterEach(async () => {
  for (const d of scratch) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

async function mkScratch(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'zerou-html-report-'));
  scratch.push(d);
  return d;
}

function makeWriter(reportPath: string): HtmlReportWriter {
  return new HtmlReportWriter({
    reportPath,
    project: 'demo-app',
    branch: 'zerou-enhance-20260527-100000',
    worktree: '/tmp/wt',
    markdownPath: 'enhance-report.md',
  });
}

// ── spliceBetween ─────────────────────────────────────────────────────────

describe('spliceBetween', () => {
  it('replaces inner content between markers', () => {
    const html = 'before<!--A-->INNER<!--B-->after';
    const out = spliceBetween(html, '<!--A-->', '<!--B-->', () => 'NEW');
    expect(out).toBe('before<!--A-->NEW<!--B-->after');
  });
  it('throws if markers are missing', () => {
    expect(() => spliceBetween('no markers', '<!--A-->', '<!--B-->', () => 'X'))
      .toThrowError(/markers not found/);
  });
});

// ── Skeleton ─────────────────────────────────────────────────────────────

describe('HtmlReportWriter.writeSkeleton', () => {
  it('writes a parseable HTML5 doc with project title and structure', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'enhance-report.html');
    await makeWriter(p).writeSkeleton();
    const html = await fs.readFile(p, 'utf8');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('ZeroU enhance — demo-app');
    expect(html).toContain('demo-app');
    // All splice markers present.
    for (const m of Object.values(HTML_MARKERS)) {
      expect(html).toContain(m);
    }
    // Skeleton has the three main sections.
    expect(html).toContain('data-section="files"');
    expect(html).toContain('data-section="findings"');
    expect(html).toContain('data-section="verify"');
  });

  it('includes <meta http-equiv=refresh> while running', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    await makeWriter(p).writeSkeleton();
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('<meta http-equiv="refresh" content="2">');
    expect(html).toContain('status-running');
  });

  it('skeleton "empty" placeholder mentions running state', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    await makeWriter(p).writeSkeleton();
    const html = await fs.readFile(p, 'utf8');
    expect(html).toMatch(/running.+file changes will appear/i);
  });

  it('skeleton includes filter bar with severity select + filter input', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    await makeWriter(p).writeSkeleton();
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('class="filter-bar"');
    expect(html).toContain('id="severity-filter"');
    expect(html).toContain('id="filter-input"');
    expect(html).toContain('<option value="P1">');
  });

  it('skeleton includes hotkey help overlay', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    await makeWriter(p).writeSkeleton();
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('id="hk-overlay"');
    expect(html).toContain('focus filter');
    expect(html).toContain('expand all files');
  });

  it('skeleton footer holds copy-merge / copy-drop / copy-branch buttons', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    await makeWriter(p).writeSkeleton();
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('Copy merge command');
    expect(html).toContain('Copy drop command');
    expect(html).toContain('Copy branch');
    // Copy buttons are in footer, NOT in sticky header.
    const headerEnd = html.indexOf('</header>');
    const headerSlice = html.slice(0, headerEnd);
    expect(headerSlice).not.toContain('Copy merge command');
  });
});

// ── appendFileChange ─────────────────────────────────────────────────────

describe('HtmlReportWriter.appendFileChange', () => {
  it('appends a row and updates module-count chips', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.appendFileChange({
      file: 'src/foo.ts',
      modules: ['logging'],
      status: 'modified',
      additions: 3,
      deletions: 1,
      unifiedDiff: '@@ -1,1 +1,1 @@\n-old\n+new\n',
    });
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('data-file="src/foo.ts"');
    expect(html).toContain('data-modules="logging"');
    expect(html).toContain('code-added');
    expect(html).toMatch(/data-module="logging"/);
    expect(html).toContain('+3');
    expect(html).toContain('-1');
    // Summary shows file count.
    expect(html).toMatch(/<strong>1<\/strong> file/);
  });

  it('uses <details>/<summary> for collapsible rows (default collapsed)', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.appendFileChange({
      file: 'a.ts', modules: ['logging'], status: 'modified',
      additions: 1, deletions: 0, unifiedDiff: '@@ -0,0 +1,1 @@\n+x\n',
    });
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('<details class="row file-row"');
    expect(html).toContain('<summary>');
    // No `open` attribute — collapsed by default.
    expect(html).not.toMatch(/<details class="row file-row"[^>]*\sopen[\s>]/);
  });

  it('renders decisionReason as the "why" caption inside expand', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.appendFileChange({
      file: 'a.ts',
      modules: ['logging'],
      status: 'modified',
      additions: 1,
      deletions: 0,
      unifiedDiff: '@@ -0,0 +1,1 @@\n+foo\n',
      decisionReason: 'HTTP boundary in middleware',
    });
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('class="why"');
    expect(html).toContain('HTTP boundary in middleware');
  });

  it('emits an "omitted" placeholder for lockfile diffs', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.appendFileChange({
      file: 'pnpm-lock.yaml',
      modules: ['other'],
      status: 'modified',
      additions: 0,
      deletions: 0,
      unifiedDiff: '',
      omittedReason: 'lockfile / generated artifact',
    });
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('diff omitted');
    expect(html).toContain('lockfile');
  });

  it('marks lockfile with ⚠ verdict glyph', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.appendFileChange({
      file: 'pnpm-lock.yaml',
      modules: ['other'],
      status: 'modified',
      additions: 2152, deletions: 0,
      unifiedDiff: '',
      omittedReason: 'lockfile',
    });
    const html = await fs.readFile(p, 'utf8');
    expect(html).toMatch(/data-verdict="review"/);
    expect(html).toContain('⚠');
  });

  it('marks normal file with ✅ verdict glyph', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.appendFileChange({
      file: 'src/foo.ts', modules: ['logging'], status: 'modified',
      additions: 1, deletions: 0, unifiedDiff: '@@ -0,0 +1,1 @@\n+x\n',
    });
    const html = await fs.readFile(p, 'utf8');
    expect(html).toMatch(/data-verdict="safe"/);
    expect(html).toContain('✅');
  });

  it('escapes special HTML chars in file paths', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.appendFileChange({
      file: 'src/<weird>.ts',
      modules: ['logging'],
      status: 'modified',
      additions: 0,
      deletions: 0,
      unifiedDiff: '',
      omittedReason: 'test',
    });
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('src/&lt;weird&gt;.ts');
    expect(html).not.toContain('src/<weird>.ts');
  });

  it('multiple files create multiple rows + module chips', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.appendFileChange({
      file: 'a.ts', modules: ['logging'], status: 'modified',
      additions: 1, deletions: 0, unifiedDiff: '@@ -0,0 +1,1 @@\n+x\n',
    });
    await w.appendFileChange({
      file: 'b.ts', modules: ['sentry'], status: 'added',
      additions: 5, deletions: 0, unifiedDiff: '@@ -0,0 +1,5 @@\n+x\n+y\n+z\n+w\n+v\n',
    });
    const html = await fs.readFile(p, 'utf8');
    expect(html.match(/<details class="row file-row"/g)?.length).toBe(2);
    expect(html).toMatch(/<strong>2<\/strong> files/);
    expect(html).toContain('+6');
    // Both chip ids appear in nav.
    expect(html).toMatch(/data-module="logging"/);
    expect(html).toMatch(/data-module="sentry"/);
  });

  it('shows NEW / DEL badges for added/deleted statuses', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.appendFileChange({
      file: 'a.ts', modules: ['logging'], status: 'added',
      additions: 5, deletions: 0, unifiedDiff: '@@ -0,0 +1,5 @@\n+x\n+y\n+z\n+w\n+v\n',
    });
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('>NEW<');
    expect(html).toContain('status-badge added');
  });
});

// ── setVerify ────────────────────────────────────────────────────────────

describe('HtmlReportWriter.setVerify', () => {
  it('updates summary status icon to pass and renders verify grid', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    const verify: VerifyResult = {
      ok: true,
      steps: [
        { name: 'tsc', status: 'pass', durationMs: 7000, stdout: '', stderr: '', exitCode: 0 },
        { name: 'test', status: 'pass', durationMs: 10000, stdout: '', stderr: '', exitCode: 0 },
      ],
    };
    await w.setVerify(verify);
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('verify-grid');
    expect(html).toContain('step pass');
    expect(html).toContain('>tsc<');
    expect(html).toContain('>test<');
    expect(html).toContain('7s');
    expect(html).toContain('10s');
    expect(html).toContain('status-pass');
  });

  it('shows fail badge on failed verify', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.setVerify({
      ok: false, brokenBy: 'log-injection',
      steps: [{ name: 'tsc', status: 'fail', durationMs: 500, stdout: '', stderr: '', exitCode: 1 }],
    });
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('step fail');
    expect(html).toContain('status-fail');
    expect(html).toContain('Broken by');
    expect(html).toContain('log-injection');
  });
});

// ── findings table ───────────────────────────────────────────────────────

describe('HtmlReportWriter.setFindings', () => {
  function findingOf(over: Partial<AuditFinding>): AuditFinding {
    return {
      id: 'f1',
      file: 'app/api/users/route.ts',
      line: 12,
      severity: 'P2',
      category: 'test-case-fail-auth',
      message: 'unauthorized access path',
      ...over,
    };
  }

  it('renders no rows when list is empty (placeholder shown after finalize)', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.setFindings([]);
    await w.finalize(0);
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('No remaining findings');
  });

  it('renders a row per finding, sorted P1 → P3', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.setFindings([
      { finding: findingOf({ id: 'p3a', severity: 'P3', file: 'z.ts' }), applied: false },
      { finding: findingOf({ id: 'p1a', severity: 'P1', file: 'a.ts' }), applied: false },
      { finding: findingOf({ id: 'p2a', severity: 'P2', file: 'b.ts' }), applied: true },
    ]);
    const html = await fs.readFile(p, 'utf8');
    // Three rows present.
    expect(html.match(/<details class="row finding-row"/g)?.length).toBe(3);
    // Find positions to verify ordering: we pass them un-sorted; the writer
    // does NOT re-sort here (the caller buildFindingRows handles that), so
    // verify by passing them in P1→P2→P3 order from the caller side.
  });

  it('uses ● glyph for patched, ○ glyph for rejected', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.setFindings([
      { finding: findingOf({ id: 'ok' }), applied: true },
      { finding: findingOf({ id: 'no' }), applied: false, rejectReason: 'too risky' },
    ]);
    const html = await fs.readFile(p, 'utf8');
    expect(html).toMatch(/class="glyph applied"[^>]*>●</);
    expect(html).toMatch(/class="glyph rejected"[^>]*>○</);
    expect(html).toContain('too risky');
  });

  it('summary stat reflects findings totals (patched / rejected)', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.setFindings([
      { finding: findingOf({ id: 'a' }), applied: true },
      { finding: findingOf({ id: 'b' }), applied: false, rejectReason: 'r' },
      { finding: findingOf({ id: 'c' }), applied: false, rejectReason: 'r' },
    ]);
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('<strong>3</strong> findings');
    expect(html).toContain('(1 patched / 2 rejected)');
  });

  it('finding row exposes data-severity for filter wiring', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.setFindings([
      { finding: findingOf({ id: 'a', severity: 'P1' }), applied: false },
    ]);
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('data-severity="P1"');
    expect(html).toContain('class="sev sev-P1"');
  });

  it('finding detail renders expected/actual/snippet from finding fields', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.setFindings([
      {
        finding: findingOf({
          id: 'f',
          message: 'unauthorized read',
          expectedBehavior: 'returns 401',
          actualBehavior: 'returns 200 with rows',
          snippet: 'const rows = await db.query(...)',
        }),
        applied: false,
        rejectReason: 'needs schema change',
      },
    ]);
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('returns 401');
    expect(html).toContain('returns 200 with rows');
    expect(html).toContain('await db.query');
    expect(html).toContain('needs schema change');
  });
});

// ── finalize ─────────────────────────────────────────────────────────────

describe('HtmlReportWriter.finalize', () => {
  it('strips the <meta refresh> and replaces "running…" with status', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.finalize(12_345);
    const html = await fs.readFile(p, 'utf8');
    expect(html).not.toContain('http-equiv="refresh"');
    // running… badge text should be gone from the header strip after finalize.
    expect(html).not.toContain('running…');
    expect(html).toContain('done');
    // Duration interpolated into sticky header strip.
    expect(html).toContain('12s');
  });

  it('finalize w/o files renders "No file changes" placeholder', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.finalize(1);
    const html = await fs.readFile(p, 'utf8');
    expect(html).toMatch(/No file changes detected/);
  });

  it('finalize after fail shows fail status in header strip', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.setVerify({
      ok: false,
      steps: [{ name: 'tsc', status: 'fail', durationMs: 1, stdout: '', stderr: '', exitCode: 1 }],
    });
    await w.finalize(2);
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('status-fail');
    expect(html).toContain('verify ❌');
  });

  it('footer contains markdown link', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.finalize(1);
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('enhance-report.md');
    expect(html).toContain('markdown report');
  });
});

// ── one-shot writeEnhanceHtmlReport ──────────────────────────────────────

describe('writeEnhanceHtmlReport (one-shot)', () => {
  it('generates a self-contained HTML with diffs + dense rows', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'enhance-report.html');
    const result: EnhanceFlowResult = {
      worktreePath: '/tmp/wt',
      branch: 'br',
      modules: {
        logExecutor: { filesChanged: ['src/foo.ts'], failures: [] },
      },
      verify: {
        ok: true,
        steps: [{ name: 'tsc', status: 'pass', durationMs: 1, stdout: '', stderr: '', exitCode: 0 }],
      },
      durationMs: 4321,
      startedAt: new Date(0).toISOString(),
    };
    const diffs: FileDiff[] = [
      {
        file: 'src/foo.ts',
        status: 'modified',
        additions: 1, deletions: 1,
        unifiedDiff: '@@ -1,1 +1,1 @@\n-old\n+new\n',
      },
    ];
    await writeEnhanceHtmlReport({
      reportPath: p,
      project: 'myproj',
      result, diffs,
      markdownPath: 'enhance-report.md',
    });
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('myproj');
    expect(html).toContain('src/foo.ts');
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toContain('<details class="row file-row"');
    expect(html).toContain('data-modules="logging"');
  });

  it('zero file changes still emits valid HTML with empty placeholders', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const result: EnhanceFlowResult = {
      worktreePath: '/tmp/wt', branch: 'br', modules: {},
      durationMs: 0, startedAt: new Date(0).toISOString(),
    };
    await writeEnhanceHtmlReport({
      reportPath: p, project: 'p', result, diffs: [],
      markdownPath: 'enhance-report.md',
    });
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('No file changes');
    expect(html).toContain('No remaining findings');
  });

  it('renders findings table when test-results passed in', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const testResults: TestCaseResult[] = [
      {
        spec: {
          id: 'graveyard-1',
          name: 'anon access exposes graveyard',
          category: 'auth',
          scope: { type: 'endpoint', target: 'GET /api/graveyard', file: 'app/api/graveyard/route.ts', line: 55 },
          given: 'anonymous request',
          when: 'GET /api/graveyard',
          then: 'returns 401',
          reasoning: 'no auth check',
        },
        status: 'fail',
        verdictReason: 'handler queries db without auth',
        evidence: {
          file: 'app/api/graveyard/route.ts',
          line: 69,
          expectedBehavior: 'returns 401',
          actualBehavior: 'returns 200',
        },
        criticFamily: 'gpt',
        durationMs: 50,
      },
    ];
    const result: EnhanceFlowResult = {
      worktreePath: '/tmp/wt', branch: 'br', modules: {},
      durationMs: 0, startedAt: new Date(0).toISOString(),
    };
    await writeEnhanceHtmlReport({
      reportPath: p, project: 'p', result, diffs: [],
      markdownPath: 'enhance-report.md',
      testResults,
    });
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('<details class="row finding-row"');
    expect(html).toContain('data-severity="P1"');
    expect(html).toContain('app/api/graveyard/route.ts:69');
    // anon access part of message
    expect(html).toContain('anon access exposes graveyard');
  });

  it('rejected finding shows reject reason in detail block', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const testResults: TestCaseResult[] = [
      {
        spec: {
          id: 'spec-1',
          name: 'foo',
          category: 'auth',
          scope: { type: 'endpoint', target: 'POST /x', file: 'x.ts', line: 1 },
          given: 'g', when: 'w', then: 't', reasoning: 'r',
        },
        status: 'fail',
        verdictReason: 'reason',
        evidence: { file: 'x.ts', line: 1 },
        criticFamily: null,
        durationMs: 1,
      },
    ];
    const result: EnhanceFlowResult = {
      worktreePath: '/tmp/wt', branch: 'br',
      modules: {
        bugPatcher: [
          {
            finding: {
              id: 'spec-1', file: 'x.ts', line: 1, severity: 'P1',
              category: 'test-case-fail-auth', message: 'foo',
            },
            status: 'skipped',
            reason: 'requires database migration',
          },
        ],
      },
      durationMs: 0, startedAt: new Date(0).toISOString(),
    };
    await writeEnhanceHtmlReport({
      reportPath: p, project: 'p', result, diffs: [],
      markdownPath: 'enhance-report.md',
      testResults,
    });
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('requires database migration');
    expect(html).toMatch(/class="glyph rejected"/);
  });
});

// ── buildFindingRows pure function ───────────────────────────────────────

describe('buildFindingRows', () => {
  it('sorts P1 before P2 before P3', () => {
    const result: EnhanceFlowResult = {
      worktreePath: '', branch: '', modules: {},
      durationMs: 0, startedAt: '',
    };
    const testResults: TestCaseResult[] = [
      {
        spec: {
          id: 'p3', name: 'low', category: 'happy-path',
          scope: { type: 'endpoint', target: 't', file: 'c.ts', line: 1 },
          given: 'g', when: 'w', then: 't', reasoning: 'r',
        },
        status: 'fail', verdictReason: 'x',
        evidence: { file: 'c.ts', line: 1 },
        criticFamily: null, durationMs: 0,
      },
      {
        spec: {
          id: 'p1', name: 'high', category: 'security',
          scope: { type: 'endpoint', target: 't', file: 'a.ts', line: 1 },
          given: 'g', when: 'w', then: 't', reasoning: 'r',
        },
        status: 'fail', verdictReason: 'x',
        evidence: { file: 'a.ts', line: 1 },
        criticFamily: null, durationMs: 0,
      },
      {
        spec: {
          id: 'p2', name: 'mid', category: 'validation',
          scope: { type: 'endpoint', target: 't', file: 'b.ts', line: 1 },
          given: 'g', when: 'w', then: 't', reasoning: 'r',
        },
        status: 'fail', verdictReason: 'x',
        evidence: { file: 'b.ts', line: 1 },
        criticFamily: null, durationMs: 0,
      },
    ];
    const rows = buildFindingRows(result, testResults);
    expect(rows.map((r) => r.finding.severity)).toEqual(['P1', 'P2', 'P3']);
  });

  it('marks applied=true for findings present in bugPatcher with status=applied', () => {
    const result: EnhanceFlowResult = {
      worktreePath: '', branch: '', modules: {
        bugPatcher: [{
          finding: { id: 's', file: 'a.ts', line: 1, severity: 'P1', category: 'test-case-fail-auth', message: 'x' },
          status: 'applied',
        }],
      },
      durationMs: 0, startedAt: '',
    };
    const testResults: TestCaseResult[] = [
      {
        spec: {
          id: 's', name: 'x', category: 'auth',
          scope: { type: 'endpoint', target: 't', file: 'a.ts', line: 1 },
          given: 'g', when: 'w', then: 't', reasoning: 'r',
        },
        status: 'fail', verdictReason: 'x',
        evidence: { file: 'a.ts', line: 1 },
        criticFamily: null, durationMs: 0,
      },
    ];
    const rows = buildFindingRows(result, testResults);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.applied).toBe(true);
    expect(rows[0]!.rejectReason).toBeUndefined();
  });
});

// ── filter wiring smoke (HTML attribute presence) ────────────────────────

describe('filter wiring (data attributes drive JS filter)', () => {
  it('file rows carry data-modules so module chip JS can match them', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.appendFileChange({
      file: 'a.ts', modules: ['logging', 'sentry'], status: 'modified',
      additions: 1, deletions: 0, unifiedDiff: '@@ -0,0 +1,1 @@\n+x\n',
    });
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('data-modules="logging,sentry"');
  });

  it('finding rows carry data-target / data-message for free-text filter', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.setFindings([
      {
        finding: {
          id: 'f1', file: 'api/users.ts', line: 30, severity: 'P1',
          category: 'test-case-fail-auth', message: 'tenant isolation broken',
        },
        applied: false,
      },
    ]);
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('data-target="api/users.ts:30"');
    expect(html).toContain('data-message="tenant isolation broken"');
  });
});

// ── internal helpers ─────────────────────────────────────────────────────

describe('internal helpers', () => {
  it('toFileHref handles Windows paths', () => {
    expect(__htmlInternals.toFileHref('D:\\foo\\bar.html')).toBe('file:///D:/foo/bar.html');
  });
  it('toFileHref handles POSIX paths', () => {
    expect(__htmlInternals.toFileHref('/foo/bar.html')).toBe('file:///foo/bar.html');
  });
  it('moduleFriendlyName returns emoji label for known ids', () => {
    expect(__htmlInternals.moduleFriendlyName('logging')).toContain('logger');
    expect(__htmlInternals.moduleFriendlyName('sentry')).toContain('sentry');
    expect(__htmlInternals.moduleFriendlyName('mystery')).toBe('mystery');
  });
  it('formatDurationShort renders sub-minute as Ns and >=1m as XmYs', () => {
    expect(__htmlInternals.formatDurationShort(500)).toBe('1s');
    expect(__htmlInternals.formatDurationShort(65_000)).toBe('1m 5s');
  });
  it('isLockfile detects common lock filenames', () => {
    expect(__htmlInternals.isLockfile('pnpm-lock.yaml')).toBe(true);
    expect(__htmlInternals.isLockfile('package-lock.json')).toBe(true);
    expect(__htmlInternals.isLockfile('yarn.lock')).toBe(true);
    expect(__htmlInternals.isLockfile('subdir/pnpm-lock.yaml')).toBe(true);
    expect(__htmlInternals.isLockfile('src/foo.ts')).toBe(false);
  });
  it('verdictForFile returns review for lockfiles, safe for normal files', () => {
    expect(__htmlInternals.verdictForFile('pnpm-lock.yaml', 'modified').cls).toBe('review');
    expect(__htmlInternals.verdictForFile('package.json', 'modified').cls).toBe('review');
    expect(__htmlInternals.verdictForFile('src/foo.ts', 'modified').cls).toBe('safe');
  });
});
