/**
 * Tests for vitest-orchestrator.
 *
 * Strategy: drive a real `npx vitest` subprocess against fixture projects
 * under __fixtures__/vitest-cases/. The fixtures rely on module resolution
 * walking up to /node_modules/vitest, which is installed at the repo root
 * via npm workspaces — no per-fixture npm install needed.
 *
 * Each subprocess run is bounded (timeoutMs) so test failures don't hang CI.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runVitest } from './vitest-orchestrator.js';
import {
  createTrackLogger,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
  type TrackLogger,
} from '../../log-types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PASS_ONLY = path.join(here, '__fixtures__', 'vitest-cases', 'pass-only');
const FIXTURE_PASS_FAIL = path.join(here, '__fixtures__', 'vitest-cases', 'pass-fail');
const FIXTURE_WITH_COVERAGE = path.join(here, '__fixtures__', 'vitest-cases', 'with-coverage');
const FIXTURE_HANG = path.join(here, '__fixtures__', 'vitest-cases', 'hang');

let scratchDirs: string[] = [];
let logger: TrackLogger;

beforeEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
  scratchDirs = [];
  logger = createTrackLogger('agent');
});

afterEach(async () => {
  // Best-effort: nuke .zerou/coverage left in fixture dirs from --coverage runs.
  for (const d of [FIXTURE_PASS_ONLY, FIXTURE_PASS_FAIL, FIXTURE_WITH_COVERAGE, FIXTURE_HANG]) {
    await fs.rm(path.join(d, '.zerou'), { recursive: true, force: true }).catch(() => {});
  }
  for (const d of scratchDirs) {
    await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  }
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});

async function makeScratchDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zerou-vitest-orch-'));
  scratchDirs.push(dir);
  return dir;
}

describe('runVitest — happy paths', () => {
  it('runs a passing test suite and reports pass=2 fail=0', async () => {
    const r = await runVitest({
      cwd: FIXTURE_PASS_ONLY,
      testDir: '.',
      logger,
      timeoutMs: 60_000,
    });
    expect(r.status).toBe('ok');
    expect(r.exitCode).toBe(0);
    expect(r.pass).toBe(2);
    expect(r.fail).toBe(0);
    expect(r.skipped).toBe(0);
    expect(r.failures).toHaveLength(0);
    expect(r.testFiles).toBeGreaterThanOrEqual(1);
    expect(r.durationMs).toBeGreaterThan(0);
    expect(r.rawStdout.length).toBeGreaterThan(0);
  }, 90_000);

  it('reports pass + fail + skipped with failure details for a mixed suite', async () => {
    const r = await runVitest({
      cwd: FIXTURE_PASS_FAIL,
      testDir: '.',
      logger,
      timeoutMs: 60_000,
    });
    expect(r.status).toBe('tests-failed');
    expect(r.exitCode).not.toBe(0);
    expect(r.pass).toBe(1);
    expect(r.fail).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.failures).toHaveLength(1);
    const f = r.failures[0]!;
    expect(f.test).toMatch(/intentionally fails/);
    expect(f.errorMessage.length).toBeGreaterThan(0);
    // mixed.test.ts is the file
    expect(f.file).toMatch(/mixed\.test\.ts/);
  }, 90_000);
});

describe('runVitest — graceful degradation', () => {
  it('returns no-test-dir when testDir does not exist', async () => {
    const cwd = await makeScratchDir();
    const r = await runVitest({
      cwd,
      testDir: 'definitely-not-here',
      logger,
      timeoutMs: 10_000,
    });
    expect(r.status).toBe('no-test-dir');
    expect(r.exitCode).not.toBe(0);
    expect(r.pass).toBe(0);
    expect(r.fail).toBe(0);
    expect(r.testFiles).toBe(0);
    expect(r.failures).toEqual([]);
    expect(r.rawStdout).toMatch(/testDir not found/);
  });

  it('returns binary-missing when npx cannot find vitest', async () => {
    // Force a fake npx binary that doesn't exist anywhere in PATH.
    const cwd = await makeScratchDir();
    // Create a tests dir so the testDir guard passes.
    await fs.mkdir(path.join(cwd, 'tests'), { recursive: true });
    const r = await runVitest({
      cwd,
      testDir: 'tests',
      logger,
      timeoutMs: 10_000,
      npxBin: '__zerou_nonexistent_binary_xyz__',
    });
    expect(['binary-missing', 'spawn-error']).toContain(r.status);
    expect(r.exitCode).not.toBe(0);
    expect(r.pass).toBe(0);
    expect(r.fail).toBe(0);
  }, 30_000);

  it('returns timed-out when run exceeds timeoutMs', async () => {
    const r = await runVitest({
      cwd: FIXTURE_HANG,
      testDir: '.',
      logger,
      timeoutMs: 5_000,
    });
    expect(r.status).toBe('timed-out');
    expect(r.exitCode).not.toBe(0);
  }, 30_000);
});

describe('runVitest — with coverage', () => {
  it('produces coverage-summary.json when withCoverage=true', async () => {
    const coverageDir = path.join(FIXTURE_WITH_COVERAGE, '.zerou', 'coverage');
    // Make sure clean.
    await fs.rm(coverageDir, { recursive: true, force: true }).catch(() => {});

    const r = await runVitest({
      cwd: FIXTURE_WITH_COVERAGE,
      testDir: 'tests',
      withCoverage: true,
      logger,
      timeoutMs: 120_000,
    });
    expect(r.status).toBe('ok');
    expect(r.pass).toBe(2);
    expect(r.fail).toBe(0);

    // coverage-summary.json should now exist
    const summaryPath = path.join(coverageDir, 'coverage-summary.json');
    const stat = await fs.stat(summaryPath).catch(() => null);
    expect(stat).not.toBeNull();
    expect(stat!.isFile()).toBe(true);
  }, 180_000);
});
