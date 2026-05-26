/**
 * Coverage parser — reads vitest's Istanbul `coverage-summary.json` and
 * normalises it into a flat CoverageReport for the audit report and the
 * iteration loop. Phase 8 §coverage-parser (Track 8C).
 *
 * Input file format (Istanbul):
 *   {
 *     "total": {
 *       "lines":     { "total": N, "covered": K, "skipped": 0, "pct": P },
 *       "branches":  { ... },
 *       "functions": { ... },
 *       "statements":{ ... }
 *     },
 *     "<absolute-or-rel-file-path>": { ...same shape as total... },
 *     ...
 *   }
 *
 * We expose only what the iteration loop / report actually use:
 *   - aggregate line / branch totals + pct
 *   - per-file lines, branches, lineCovPct (for "least-covered file" surfacing)
 *
 * Safety: any IO or parse error → returns null (not throw). The audit just
 * skips the coverage section in that case.
 *
 * Emits:
 *   - agent.coverage.read-decision { coverageDir, found: boolean }
 *   - agent.coverage.parse-decision { decision: 'ok' | 'malformed' | 'empty' }
 *   - agent.coverage.complete { lineCovPct, branchCovPct, fileCount }
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TrackLogger } from '../../log-types.js';
import { logBranch, logCatch } from '../../log/branch.js';

export interface CoverageMetric {
  total: number;
  covered: number;
  pct: number;
}

export interface CoverageReport {
  lines: CoverageMetric;
  branches: CoverageMetric;
  byFile: Record<
    string,
    { lines: number; branches: number; lineCovPct: number }
  >;
}

export interface ParseCoverageOptions {
  /** Project root the coverage was generated from. */
  cwd: string;
  /** Directory containing `coverage-summary.json`. */
  coverageDir: string;
  /** Required for decision-branch tracing. */
  logger: TrackLogger;
}

const SUMMARY_FILENAME = 'coverage-summary.json';

export async function parseCoverage(
  opts: ParseCoverageOptions,
): Promise<CoverageReport | null> {
  const { cwd, coverageDir, logger } = opts;
  const summaryPath = path.isAbsolute(coverageDir)
    ? path.join(coverageDir, SUMMARY_FILENAME)
    : path.join(cwd, coverageDir, SUMMARY_FILENAME);

  let raw: string;
  try {
    raw = await fs.readFile(summaryPath, 'utf8');
    logBranch(logger, 'agent.coverage.read-decision', {
      decision: 'found',
      coverageDir,
      summaryPath,
      found: true,
    });
  } catch (err) {
    logBranch(logger, 'agent.coverage.read-decision', {
      decision: 'not-found',
      coverageDir,
      summaryPath,
      found: false,
      reason: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    logCatch(logger, 'agent.coverage.parse-decision', err, {
      decision: 'malformed',
      summaryPath,
    });
    return null;
  }

  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    logBranch(logger, 'agent.coverage.parse-decision', {
      decision: 'malformed',
      reason: 'top-level not an object',
    });
    return null;
  }

  const root = json as Record<string, unknown>;
  const total = extractMetricBundle(root.total);
  if (!total) {
    logBranch(logger, 'agent.coverage.parse-decision', {
      decision: 'malformed',
      reason: 'missing total bundle',
    });
    return null;
  }

  const byFile: CoverageReport['byFile'] = {};
  let fileCount = 0;
  for (const key of Object.keys(root)) {
    if (key === 'total') continue;
    const entry = extractMetricBundle(root[key]);
    if (!entry) continue;
    byFile[key] = {
      lines: entry.lines.total,
      branches: entry.branches.total,
      lineCovPct: entry.lines.pct,
    };
    fileCount++;
  }

  logBranch(logger, 'agent.coverage.parse-decision', {
    decision: fileCount === 0 ? 'empty' : 'ok',
    fileCount,
  });

  const report: CoverageReport = {
    lines: total.lines,
    branches: total.branches,
    byFile,
  };

  logger.log('info', 'agent.coverage.complete', {
    lineCovPct: report.lines.pct,
    branchCovPct: report.branches.pct,
    fileCount,
  });

  return report;
}

interface MetricBundle {
  lines: CoverageMetric;
  branches: CoverageMetric;
}

function extractMetricBundle(node: unknown): MetricBundle | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  const lines = coerceMetric(obj.lines);
  const branches = coerceMetric(obj.branches);
  if (!lines || !branches) return null;
  return { lines, branches };
}

function coerceMetric(node: unknown): CoverageMetric | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  const total = toNumber(obj.total);
  const covered = toNumber(obj.covered);
  const pct = toNumber(obj.pct);
  if (total === null || covered === null || pct === null) return null;
  return { total, covered, pct };
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
