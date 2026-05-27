/**
 * Tests for enhance/html-report.ts (Phase 11 HTML report writer).
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
  __htmlInternals,
} from './html-report.js';
import type { EnhanceFlowResult, FileDiff, VerifyResult } from './types.js';

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

describe('HtmlReportWriter.writeSkeleton', () => {
  it('writes a parseable HTML5 doc with project title and branch', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'enhance-report.html');
    await makeWriter(p).writeSkeleton();
    const html = await fs.readFile(p, 'utf8');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('ZeroU enhance — demo-app');
    expect(html).toContain('zerou-enhance-20260527-100000');
    expect(html).toContain('Copy merge command');
    expect(html).toContain('Copy drop command');
    // All splice markers present.
    for (const m of Object.values(HTML_MARKERS)) {
      expect(html).toContain(m);
    }
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
    expect(html).toMatch(/Running.+changes will appear/i);
  });
});

describe('HtmlReportWriter.appendFileChange', () => {
  it('appends an article and updates module-count chips', async () => {
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
    // Nav chip present.
    expect(html).toMatch(/data-module="logging"/);
    expect(html).toContain('+3 / -1');
    // Summary updated.
    expect(html).toContain('📁 1 file');
  });

  it('renders decisionReason as the "why" caption', async () => {
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
    expect(html).toContain('Why ZeroU did this');
    expect(html).toContain('HTTP boundary in middleware');
  });

  it('emits a placeholder for omitted (lockfile) diffs', async () => {
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
    expect(html).toContain('Diff omitted');
    expect(html).toContain('lockfile');
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
    expect(html).not.toContain('<weird>');
  });

  it('multiple files create multiple articles', async () => {
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
    expect(html.match(/<article class="file-change"/g)?.length).toBe(2);
    expect(html).toContain('📁 2 files');
    expect(html).toContain('+6 / -0');
    // Both chip ids appear in nav.
    expect(html).toMatch(/data-module="logging"/);
    expect(html).toMatch(/data-module="sentry"/);
  });
});

describe('HtmlReportWriter.setVerify', () => {
  it('updates summary status icon to pass', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    const verify: VerifyResult = {
      ok: true,
      steps: [
        { name: 'tsc', status: 'pass', durationMs: 1000, stdout: '', stderr: '', exitCode: 0 },
        { name: 'test', status: 'pass', durationMs: 2000, stdout: '', stderr: '', exitCode: 0 },
      ],
    };
    await w.setVerify(verify);
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('verify passed');
    expect(html).toContain('status-pass');
    expect(html).toContain('tsc');
    expect(html).toContain('test');
  });

  it('shows fail icon on failed verify', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.setVerify({
      ok: false, brokenBy: 'log-injection',
      steps: [{ name: 'tsc', status: 'fail', durationMs: 500, stdout: '', stderr: '', exitCode: 1 }],
    });
    const html = await fs.readFile(p, 'utf8');
    expect(html).toContain('verify failed');
    expect(html).toContain('status-fail');
    expect(html).toContain('Broken by');
    expect(html).toContain('log-injection');
  });
});

describe('HtmlReportWriter.finalize', () => {
  it('strips the <meta refresh> and replaces "Running..." with status', async () => {
    const dir = await mkScratch();
    const p = path.join(dir, 'r.html');
    const w = makeWriter(p);
    await w.writeSkeleton();
    await w.finalize(12_345);
    const html = await fs.readFile(p, 'utf8');
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).not.toContain('Running…');
    expect(html).toContain('Done');
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

  it('finalize after fail shows fail status in header', async () => {
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
    expect(html).toContain('verify failed');
    expect(html).toContain('Done — verify failed');
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

describe('writeEnhanceHtmlReport (one-shot)', () => {
  it('generates a self-contained HTML with diffs and proper sticky header', async () => {
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
    // Live-refresh stripped after finalize.
    expect(html).not.toContain('http-equiv="refresh"');
    // Article exists.
    expect(html).toContain('<article class="file-change"');
    // Module classification picked logging.
    expect(html).toContain('data-modules="logging"');
  });

  it('zero file changes still emits valid HTML with empty placeholder', async () => {
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
  });
});

describe('internal helpers', () => {
  it('toFileHref handles Windows paths', () => {
    expect(__htmlInternals.toFileHref('D:\\foo\\bar.html')).toBe('file:///D:/foo/bar.html');
  });
  it('toFileHref handles POSIX paths', () => {
    expect(__htmlInternals.toFileHref('/foo/bar.html')).toBe('file:///foo/bar.html');
  });
  it('moduleFriendlyName returns emoji label for known ids', () => {
    expect(__htmlInternals.moduleFriendlyName('logging')).toContain('Logging');
    expect(__htmlInternals.moduleFriendlyName('sentry')).toContain('Sentry');
    expect(__htmlInternals.moduleFriendlyName('mystery')).toBe('mystery');
  });
  it('formatDurationShort renders sub-minute as Ns and >=1m as XmYs', () => {
    expect(__htmlInternals.formatDurationShort(500)).toBe('1s');
    expect(__htmlInternals.formatDurationShort(65_000)).toBe('1m 5s');
  });
});
