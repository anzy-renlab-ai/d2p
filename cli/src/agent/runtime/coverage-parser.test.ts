/**
 * Tests for coverage-parser.
 *
 * Strategy: synthesise Istanbul-shaped coverage-summary.json files in a temp
 * dir, then verify parseCoverage extracts the right shape.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseCoverage } from './coverage-parser.js';
import {
  createTrackLogger,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
  type TrackLogger,
} from '../../log-types.js';

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
  for (const d of scratchDirs) {
    await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  }
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});

async function makeScratchDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zerou-cov-parser-'));
  scratchDirs.push(dir);
  return dir;
}

async function writeSummary(
  dir: string,
  payload: unknown,
): Promise<string> {
  const covDir = path.join(dir, 'coverage');
  await fs.mkdir(covDir, { recursive: true });
  await fs.writeFile(
    path.join(covDir, 'coverage-summary.json'),
    typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
    'utf8',
  );
  return covDir;
}

describe('parseCoverage', () => {
  it('parses a valid coverage-summary.json with one file', async () => {
    const cwd = await makeScratchDir();
    const covDir = await writeSummary(cwd, {
      total: {
        lines: { total: 100, covered: 67, skipped: 0, pct: 67 },
        branches: { total: 20, covered: 10, skipped: 0, pct: 50 },
        functions: { total: 10, covered: 7, skipped: 0, pct: 70 },
        statements: { total: 100, covered: 67, skipped: 0, pct: 67 },
      },
      'src/foo.ts': {
        lines: { total: 100, covered: 67, skipped: 0, pct: 67 },
        branches: { total: 20, covered: 10, skipped: 0, pct: 50 },
        functions: { total: 10, covered: 7, skipped: 0, pct: 70 },
        statements: { total: 100, covered: 67, skipped: 0, pct: 67 },
      },
    });

    const r = await parseCoverage({ cwd, coverageDir: covDir, logger });
    expect(r).not.toBeNull();
    expect(r!.lines.total).toBe(100);
    expect(r!.lines.covered).toBe(67);
    expect(r!.lines.pct).toBe(67);
    expect(r!.branches.total).toBe(20);
    expect(r!.branches.pct).toBe(50);
    expect(Object.keys(r!.byFile)).toEqual(['src/foo.ts']);
    expect(r!.byFile['src/foo.ts']).toEqual({
      lines: 100,
      branches: 20,
      lineCovPct: 67,
    });
  });

  it('returns null when coverage-summary.json does not exist', async () => {
    const cwd = await makeScratchDir();
    const r = await parseCoverage({
      cwd,
      coverageDir: path.join(cwd, 'nonexistent'),
      logger,
    });
    expect(r).toBeNull();
  });

  it('returns null when JSON is malformed', async () => {
    const cwd = await makeScratchDir();
    const covDir = await writeSummary(cwd, '{this is not valid json');
    const r = await parseCoverage({ cwd, coverageDir: covDir, logger });
    expect(r).toBeNull();
  });

  it('aggregates multiple files into byFile correctly', async () => {
    const cwd = await makeScratchDir();
    const covDir = await writeSummary(cwd, {
      total: {
        lines: { total: 200, covered: 150, skipped: 0, pct: 75 },
        branches: { total: 40, covered: 20, skipped: 0, pct: 50 },
        functions: { total: 20, covered: 15, skipped: 0, pct: 75 },
        statements: { total: 200, covered: 150, skipped: 0, pct: 75 },
      },
      'src/a.ts': {
        lines: { total: 100, covered: 80, skipped: 0, pct: 80 },
        branches: { total: 20, covered: 12, skipped: 0, pct: 60 },
        functions: { total: 10, covered: 8, skipped: 0, pct: 80 },
        statements: { total: 100, covered: 80, skipped: 0, pct: 80 },
      },
      'src/b.ts': {
        lines: { total: 100, covered: 70, skipped: 0, pct: 70 },
        branches: { total: 20, covered: 8, skipped: 0, pct: 40 },
        functions: { total: 10, covered: 7, skipped: 0, pct: 70 },
        statements: { total: 100, covered: 70, skipped: 0, pct: 70 },
      },
    });

    const r = await parseCoverage({ cwd, coverageDir: covDir, logger });
    expect(r).not.toBeNull();
    expect(r!.lines.pct).toBe(75);
    expect(Object.keys(r!.byFile).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(r!.byFile['src/a.ts']!.lineCovPct).toBe(80);
    expect(r!.byFile['src/b.ts']!.lineCovPct).toBe(70);
  });

  it('returns null when top-level is missing the `total` bundle', async () => {
    const cwd = await makeScratchDir();
    const covDir = await writeSummary(cwd, { 'src/a.ts': {} });
    const r = await parseCoverage({ cwd, coverageDir: covDir, logger });
    expect(r).toBeNull();
  });

  it('accepts an absolute coverageDir path', async () => {
    const cwd = await makeScratchDir();
    const covDir = await writeSummary(cwd, {
      total: {
        lines: { total: 10, covered: 10, skipped: 0, pct: 100 },
        branches: { total: 2, covered: 2, skipped: 0, pct: 100 },
        functions: { total: 1, covered: 1, skipped: 0, pct: 100 },
        statements: { total: 10, covered: 10, skipped: 0, pct: 100 },
      },
    });
    // covDir is already absolute (mkdtemp gives absolute paths on all OSes).
    expect(path.isAbsolute(covDir)).toBe(true);
    const r = await parseCoverage({
      cwd: '/some/other/cwd',
      coverageDir: covDir,
      logger,
    });
    expect(r).not.toBeNull();
    expect(r!.lines.pct).toBe(100);
  });
});
