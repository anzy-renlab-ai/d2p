/**
 * Tests for enhance/report.ts (Module H).
 *
 * Strategy: render fully-mocked EnhanceFlowResult objects into markdown and
 * assert on the resulting string structure. Disk-write is exercised in one
 * test using a tmpdir.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { writeEnhanceReport, renderReport, __internals } from './report.js';
import type {
  EnhanceFlowResult,
  FileDiff,
  InjectionPlan,
  PatchResult,
  VerifyResult,
} from './types.js';
import {
  createTrackLogger,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
  type TrackLogger,
} from '../log-types.js';

let scratchDirs: string[] = [];
let logger: TrackLogger;

beforeEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
  scratchDirs = [];
  logger = createTrackLogger('cli', { silent: true });
});

afterEach(async () => {
  for (const d of scratchDirs) {
    await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  }
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});

async function mkScratch(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zerou-report-'));
  scratchDirs.push(dir);
  return dir;
}

function fullResult(overrides: Partial<EnhanceFlowResult> = {}): EnhanceFlowResult {
  const plan: InjectionPlan = {
    loggerLib: 'pino',
    framework: 'express',
    installDeps: ['pino', 'pino-http'],
    bootstrapFile: 'src/logger.ts',
    middlewareFile: null,
    sites: [
      {
        file: 'src/index.ts',
        line: 10,
        endLine: 10,
        kind: 'http-boundary',
        preview: 'app.use(...)',
      },
      {
        file: 'src/index.ts',
        line: 20,
        endLine: 20,
        kind: 'console-log',
        preview: 'console.log(...)',
      },
      {
        file: 'src/db.ts',
        line: 5,
        endLine: 5,
        kind: 'db-call',
        preview: 'db.query(...)',
      },
    ],
  };

  const patches: PatchResult[] = [
    {
      finding: {
        id: 'observability.silent-catch.src/x.ts:42',
        file: 'src/x.ts',
        line: 42,
        severity: 'P2',
        category: 'observability',
        message: 'silent catch',
      },
      status: 'applied',
      diff: '--- a/src/x.ts\n+++ b/src/x.ts\n@@ -42 +42 @@\n-catch (e) {}\n+catch (e) { logger.warn({ err: e }, "ignored"); }\n',
    },
    {
      finding: {
        id: 'sitemap.escape.app/sitemap.xml/route.ts:116',
        file: 'app/sitemap.xml/route.ts',
        line: 116,
        severity: 'P1',
        category: 'xss',
        message: 'no escapeXml',
      },
      status: 'skipped',
      reason: 'no-mechanical-fix-available',
    },
  ];

  const verify: VerifyResult = {
    ok: true,
    steps: [
      {
        name: 'install',
        status: 'pass',
        durationMs: 12_000,
        stdout: '',
        stderr: '',
        exitCode: 0,
      },
      {
        name: 'tsc',
        status: 'pass',
        durationMs: 3_500,
        stdout: '',
        stderr: '',
        exitCode: 0,
      },
      {
        name: 'test',
        status: 'pass',
        durationMs: 4_200,
        stdout: '',
        stderr: '',
        exitCode: 0,
      },
      {
        name: 'build',
        status: 'skipped',
        durationMs: 0,
        stdout: '[verify] skipped: no-build-script\n',
        stderr: '',
        exitCode: null,
      },
    ],
  };

  return {
    worktreePath: '/tmp/demo/.worktrees/zerou-enhance-1234',
    branch: 'zerou-enhance-1234',
    modules: {
      logPlanner: plan,
      logExecutor: { filesChanged: ['src/index.ts', 'src/db.ts'], failures: [] },
      bugPatcher: patches,
      healthGen: { added: 'app/health/route.ts' },
      sentryInstaller: {
        added: ['sentry.client.config.ts', 'sentry.server.config.ts'],
        dependencies: ['@sentry/nextjs'],
        bootstrapPatched: null,
      },
      envCompleter: {
        added: ['DATABASE_URL', 'STRIPE_KEY'],
        existed: ['NODE_ENV'],
        unusedRemoved: [],
      },
    },
    verify,
    durationMs: 75_000, // 1m 15s
    startedAt: '2026-05-27T10:00:00.000Z',
    ...overrides,
  };
}

describe('renderReport — full module coverage', () => {
  it('renders all 6 module sections + header + summary + how-to-review', () => {
    const md = renderReport('/tmp/demo', fullResult());
    expect(md).toMatch(/^# ZeroU Enhance Report/);
    expect(md).toMatch(/\*\*Project\*\*: demo/);
    expect(md).toMatch(/\*\*Branch\*\*: zerou-enhance-1234/);
    expect(md).toMatch(/\*\*Worktree\*\*: \/tmp\/demo\/\.worktrees\/zerou-enhance-1234/);
    expect(md).toMatch(/\*\*Generated\*\*: 2026-05-27T10:00:00\.000Z/);
    expect(md).toMatch(/\*\*Verify\*\*: PASS/);

    // Numbered sections (1–5 modules, 6 inline diff, 7 verify)
    expect(md).toMatch(/## 1\. Module A\/B — Log injection/);
    expect(md).toMatch(/## 2\. Module C — Bug fix patches/);
    expect(md).toMatch(/## 3\. Module D — Health endpoint/);
    expect(md).toMatch(/## 4\. Module E — Sentry SDK/);
    expect(md).toMatch(/## 5\. Module F — \.env\.example/);
    expect(md).toMatch(/## 6\. Changes \(full diff inline\)/);
    expect(md).toMatch(/## 7\. Module G — Verification/);

    // Summary bullets
    expect(md).toMatch(/Log injection: 3 sites planned across 2 files changed/);
    expect(md).toMatch(/Bugs auto-patched: 1 of 2 findings/);
    expect(md).toMatch(/Health endpoint: added/);
    expect(md).toMatch(/Sentry SDK: added \(deps: @sentry\/nextjs\)/);
    expect(md).toMatch(/\.env\.example: 2 vars added/);

    // How to review
    expect(md).toMatch(/git diff main\.\.HEAD/);
    expect(md).toMatch(/git merge --no-ff zerou-enhance-1234/);
    expect(md).toMatch(/git worktree remove/);

    // Per-file log injection table
    expect(md).toMatch(/\| `src\/index\.ts` \| 2 \|/);
    expect(md).toMatch(/\| `src\/db\.ts` \| 1 \|/);

    // Bug patch table + diff
    expect(md).toMatch(/applied/);
    expect(md).toMatch(/skipped/);
    expect(md).toMatch(/no-mechanical-fix-available/);
    expect(md).toMatch(/```diff/);
    expect(md).toMatch(/logger\.warn/);
  });
});

describe('renderReport — verify table', () => {
  it('renders the verify table with status glyphs + durations', () => {
    const md = renderReport('/tmp/demo', fullResult());
    expect(md).toMatch(/\| Step \| Status \| Duration \| Notes \|/);
    expect(md).toMatch(/\| install \| ✅ \| 12s/);
    expect(md).toMatch(/\| tsc \| ✅ \| 4s/); // 3500 rounds to 4s
    expect(md).toMatch(/\| test \| ✅ \| 4s/);
    expect(md).toMatch(/\| build \| ➖ \| 0s/);
  });
});

describe('renderReport — missing module sections degrade gracefully', () => {
  it('renders placeholder text when no module data is present', () => {
    const result = fullResult({
      modules: {},
      verify: undefined,
    });
    const md = renderReport('/tmp/demo', result);
    expect(md).toMatch(/## 1\. Module A\/B — Log injection/);
    expect(md).toMatch(/_Module did not run\._/);
    expect(md).toMatch(/\*\*Verify\*\*: not run/);
    // Still has the section headings even when bodies are placeholders
    expect(md).toMatch(/## 2\. Module C — Bug fix patches/);
    expect(md).toMatch(/## 3\. Module D — Health endpoint/);
    expect(md).toMatch(/## 4\. Module E — Sentry SDK/);
    expect(md).toMatch(/## 5\. Module F — \.env\.example/);
    expect(md).toMatch(/## 6\. Changes \(full diff inline\)/);
    expect(md).toMatch(/## 7\. Module G — Verification/);
  });

  it('handles "already-tracked" sentry result', () => {
    const result = fullResult({
      modules: {
        sentryInstaller: { added: [], dependencies: [], bootstrapPatched: null },
      },
    });
    const md = renderReport('/tmp/demo', result);
    expect(md).toMatch(/Sentry SDK: already-tracked/);
  });

  it('handles health "already-exists" reason', () => {
    const result = fullResult({
      modules: {
        healthGen: { added: null, reason: 'already-exists' },
      },
    });
    const md = renderReport('/tmp/demo', result);
    expect(md).toMatch(/Skipped: already-exists/);
  });
});

describe('renderReport — duration formatting', () => {
  it('formats sub-minute durations as Xs', () => {
    expect(__internals.formatDuration(45_000)).toBe('45s');
    expect(__internals.formatDuration(0)).toBe('0s');
  });

  it('formats multi-minute durations as Xm Ys', () => {
    expect(__internals.formatDuration(75_000)).toBe('1m 15s');
    expect(__internals.formatDuration(125_000)).toBe('2m 5s');
  });

  it('renders top-level Duration line as Xm Ys', () => {
    const md = renderReport('/tmp/demo', fullResult());
    expect(md).toMatch(/\*\*Duration\*\*: 1m 15s/);
  });

  it('clamps negative/NaN duration to 0s', () => {
    expect(__internals.formatDuration(-1)).toBe('0s');
    expect(__internals.formatDuration(NaN)).toBe('0s');
  });
});

describe('renderReport — verify FAIL surfaces broken-by + tail output', () => {
  it('renders FAIL header + broken-by when verify.ok is false', () => {
    const result = fullResult({
      verify: {
        ok: false,
        brokenBy: 'Module B (log-executor)',
        steps: [
          {
            name: 'install',
            status: 'pass',
            durationMs: 5_000,
            stdout: '',
            stderr: '',
            exitCode: 0,
          },
          {
            name: 'tsc',
            status: 'fail',
            durationMs: 2_000,
            stdout: '',
            stderr: 'src/x.ts(10,5): error TS2304: Cannot find name "foo".\n',
            exitCode: 2,
          },
          {
            name: 'test',
            status: 'skipped',
            durationMs: 0,
            stdout: '[verify] skipped: prior-step-failed\n',
            stderr: '',
            exitCode: null,
          },
          {
            name: 'build',
            status: 'skipped',
            durationMs: 0,
            stdout: '[verify] skipped: prior-step-failed\n',
            stderr: '',
            exitCode: null,
          },
        ],
      },
    });
    const md = renderReport('/tmp/demo', result);
    expect(md).toMatch(/\*\*Verify\*\*: FAIL \(broken by Module B \(log-executor\)\)/);
    expect(md).toMatch(/\| tsc \| ❌ \| 2s/);
    expect(md).toMatch(/### Failed step output/);
    expect(md).toMatch(/Cannot find name "foo"/);
  });
});

describe('writeEnhanceReport — disk I/O', () => {
  it('writes the report to the given path and creates parent dirs', async () => {
    const cwd = await mkScratch();
    const reportPath = path.join(cwd, '.zerou', 'enhance-report.md');
    await writeEnhanceReport({
      cwd,
      reportPath,
      result: fullResult(),
      logger,
      // Inject a no-op fetcher so the test doesn't shell out to real git
      // against an empty scratch dir (which would degrade-render and still
      // pass, but injection makes intent explicit).
      diffFetcher: async () => [],
    });
    const written = await fs.readFile(reportPath, 'utf8');
    expect(written).toMatch(/^# ZeroU Enhance Report/);
    expect(written).toMatch(/## 7\. Module G — Verification/);
    expect(written).toMatch(/## 6\. Changes \(full diff inline\)/);
    expect(written).toMatch(/Files Changed \(0\)/);
    const stat = await fs.stat(reportPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(500);
  });
});

// ── New: inline diff rendering ─────────────────────────────────────────────

function mkDiff(file: string, body: string, status: FileDiff['status'] = 'modified', additions = 1, deletions = 1): FileDiff {
  return { file, status, additions, deletions, unifiedDiff: body };
}

function sampleDiff(file: string): string {
  return [
    `diff --git a/${file} b/${file}`,
    `index 0123456..abcdef0 100644`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,3 +1,4 @@`,
    ` const a = 1;`,
    `-const b = 2;`,
    `+const b = 22;`,
    `+const c = 3;`,
    ` // end`,
  ].join('\n');
}

describe('renderReport — inline diff section', () => {
  it('renders one ```diff fence per file when diffFetcher returns 3 file diffs', () => {
    const diffs: FileDiff[] = [
      mkDiff('src/index.ts', sampleDiff('src/index.ts'), 'modified', 2, 1),
      mkDiff('src/db.ts', sampleDiff('src/db.ts'), 'modified', 5, 0),
      mkDiff('src/new.ts', sampleDiff('src/new.ts'), 'added', 12, 0),
    ];
    const md = renderReport('/tmp/demo', fullResult(), { diffs });
    expect(md).toMatch(/## 6\. Changes \(full diff inline\)/);
    expect(md).toMatch(/### `src\/index\.ts` \(\+2, -1\)/);
    expect(md).toMatch(/### `src\/db\.ts` \(\+5, -0\)/);
    expect(md).toMatch(/### `src\/new\.ts` \(\+12, -0\) \(new\)/);
    // Three diff fences inside the inline section.
    const fences = md.match(/```diff/g) ?? [];
    // At least 3 (one per inline file). The bug-patch section may add
    // its own fence; we use >= to stay robust to that.
    expect(fences.length).toBeGreaterThanOrEqual(3);
    // Hunk header from each sample appears verbatim.
    expect(md).toMatch(/@@ -1,3 \+1,4 @@/);
  });

  it('renders "_Diff omitted_" placeholder when a single diff exceeds 50 KB', () => {
    const huge = 'a'.repeat(60 * 1024); // 60 KB
    const diffs: FileDiff[] = [
      {
        file: 'package-lock.json',
        status: 'modified',
        additions: 100,
        deletions: 100,
        unifiedDiff: '',
        omittedReason: 'lockfile / generated artifact',
      },
      // Also test that an oversized non-lockfile (without preset
      // omittedReason) gets caught by capDiffForRender.
      mkDiff('big.txt', huge, 'modified', 1000, 0),
    ];
    const md = renderReport('/tmp/demo', fullResult(), { diffs });
    expect(md).toMatch(/_Diff omitted: lockfile \/ generated artifact_/);
    expect(md).toMatch(/\[diff omitted: > 50 KB\]/);
  });

  it('truncates very long diffs to first 100 + ellipsis + last 100 lines', () => {
    // 300 lines of fake diff body — should be split 100 / [...] / 100.
    const lines: string[] = [];
    for (let i = 0; i < 300; i++) lines.push(`+line ${i}`);
    const diffs: FileDiff[] = [mkDiff('long.ts', lines.join('\n'), 'modified', 300, 0)];
    const md = renderReport('/tmp/demo', fullResult(), { diffs });
    // Elision marker present with the right omitted count.
    expect(md).toMatch(/\[\.\.\. 100 lines omitted \.\.\.\]/);
    // First-window line present.
    expect(md).toMatch(/\+line 0\b/);
    // Last-window line present.
    expect(md).toMatch(/\+line 299\b/);
    // A middle line that should have been elided is NOT present.
    expect(md).not.toMatch(/\+line 150\b/);
  });

  it('renders graceful fallback note when diff fetch errored', () => {
    const md = renderReport('/tmp/demo', fullResult(), {
      diffs: null,
      diffError: 'git not found on PATH',
    });
    expect(md).toMatch(/## 6\. Changes \(full diff inline\)/);
    expect(md).toMatch(/could not fetch diff \(git not found on PATH\)/);
    expect(md).toMatch(/Run `git diff main\.\.HEAD` manually/);
    // Other sections still rendered.
    expect(md).toMatch(/## 7\. Module G — Verification/);
  });

  it('TOC anchor matches the heading anchor for every file', () => {
    const diffs: FileDiff[] = [
      mkDiff('src/index.ts', sampleDiff('src/index.ts'), 'modified', 1, 1),
      mkDiff('app/api/route.ts', sampleDiff('app/api/route.ts'), 'added', 4, 0),
    ];
    const md = renderReport('/tmp/demo', fullResult(), { diffs });
    // For each file, the TOC link target must exist as an anchor in the body.
    for (const d of diffs) {
      const anchor = __internals.fileAnchor(d.file);
      // TOC: `- [`src/index.ts`](#srcindexts) — +1, -1`
      const tocPattern = new RegExp(`#${anchor}\\)`);
      expect(md).toMatch(tocPattern);
      // Body anchor injected as inline HTML right under the heading.
      const bodyPattern = new RegExp(`<a id="${anchor}"></a>`);
      expect(md).toMatch(bodyPattern);
    }
  });

  it('renames render the new path in heading and note the old path', () => {
    const diffs: FileDiff[] = [
      {
        file: 'src/new-name.ts',
        oldFile: 'src/old-name.ts',
        status: 'renamed',
        additions: 0,
        deletions: 0,
        unifiedDiff: [
          'diff --git a/src/old-name.ts b/src/new-name.ts',
          'similarity index 100%',
          'rename from src/old-name.ts',
          'rename to src/new-name.ts',
        ].join('\n'),
      },
    ];
    const md = renderReport('/tmp/demo', fullResult(), { diffs });
    // Heading shows new path + (renamed) tag.
    expect(md).toMatch(/### `src\/new-name\.ts` \(\+0, -0\) \(renamed\)/);
    // Old-path note rendered just below the heading.
    expect(md).toMatch(/_Renamed from `src\/old-name\.ts`\._/);
    // TOC entry surfaces the old name parenthetical.
    expect(md).toMatch(/\(was `src\/old-name\.ts`\)/);
    // The diff text itself preserves both paths.
    expect(md).toMatch(/rename from src\/old-name\.ts/);
    expect(md).toMatch(/rename to src\/new-name\.ts/);
  });

  it('renders "No file changes" placeholder when fetcher returns empty list', () => {
    const md = renderReport('/tmp/demo', fullResult(), { diffs: [] });
    expect(md).toMatch(/Files Changed \(0\)/);
    expect(md).toMatch(/No file changes between `main` and `HEAD`/);
  });
});

describe('capDiffForRender (internal)', () => {
  it('returns single-element array for diffs above the byte cap', () => {
    const huge = 'x'.repeat(__internals.DIFF_BYTES_CAP + 10);
    expect(__internals.capDiffForRender(huge)).toEqual([
      `[diff omitted: > 50 KB]`,
    ]);
  });

  it('passes through small diffs unchanged (minus trailing blank)', () => {
    const small = 'line 1\nline 2\nline 3\n';
    expect(__internals.capDiffForRender(small)).toEqual([
      'line 1',
      'line 2',
      'line 3',
    ]);
  });
});

describe('parseNameStatus (internal)', () => {
  it('parses A/M/D entries and R rename entries', () => {
    const stdout = [
      'A\tsrc/new.ts',
      'M\tsrc/changed.ts',
      'D\tsrc/gone.ts',
      'R100\tsrc/old.ts\tsrc/new-name.ts',
    ].join('\n');
    const out = __internals.parseNameStatus(stdout);
    expect(out).toEqual([
      { status: 'added', file: 'src/new.ts' },
      { status: 'modified', file: 'src/changed.ts' },
      { status: 'deleted', file: 'src/gone.ts' },
      { status: 'renamed', oldFile: 'src/old.ts', file: 'src/new-name.ts' },
    ]);
  });
});
