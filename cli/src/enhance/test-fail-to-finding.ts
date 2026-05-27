/**
 * Convert TestCaseResult[] (Phase 5 LLM-judge fails) into AuditFinding[]
 * shape that bug-patcher consumes (Phase 11.3).
 *
 * This is the bridge that closes the disconnect documented in
 * `docs/reviews/2026-05-27-bug-patcher-and-auth-wall.md`:
 *   - judge emits rich `verdictReason + evidence` per failing spec
 *   - those flow to logs but NOT to the findings table
 *   - bug-patcher reads ONLY the findings table → considers 0 inputs
 *
 * Mapping rules:
 *  - status === 'fail' → emit a finding
 *  - status === 'pass' / 'inconclusive' / 'skipped' → drop
 *  - severity derived from spec.category (no severity in TestCaseResult)
 *  - category prefix `'test-case-fail-'` keeps test-fail findings
 *    distinguishable from static hardening findings in the patcher's
 *    classifyFinding() switch.
 *  - finding.id == spec.id (preserves traceability)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TestCaseResult, TestCaseCategory } from '../agent/types.js';
import type { AuditFinding } from './types.js';

export type Severity = 'P1' | 'P2' | 'P3';

export interface ConvertOpts {
  results: TestCaseResult[];
  /** Drop findings below this severity. Default P3 (keep everything). */
  minSeverity?: Severity;
}

/** Order: P1 most severe → P3 least. */
const SEVERITY_RANK: Record<Severity, number> = { P1: 3, P2: 2, P3: 1 };

/** Category → severity map for failing specs. */
function severityForCategory(cat: TestCaseCategory): Severity {
  switch (cat) {
    case 'security':
    case 'auth':
      return 'P1';
    case 'validation':
    case 'error-handling':
      return 'P2';
    case 'edge-case':
    case 'happy-path':
    default:
      return 'P3';
  }
}

/**
 * Convert failing TestCaseResults to AuditFindings.
 * Pass + inconclusive + skipped statuses are dropped silently.
 */
export function testFailsToFindings(opts: ConvertOpts): AuditFinding[] {
  const minSev = opts.minSeverity ?? 'P3';
  const minRank = SEVERITY_RANK[minSev];
  const out: AuditFinding[] = [];

  for (const r of opts.results) {
    if (r.status !== 'fail') continue;
    const sev = severityForCategory(r.spec.category);
    if (SEVERITY_RANK[sev] < minRank) continue;

    const file = r.evidence.file ?? r.spec.scope.file;
    const line = r.evidence.line ?? r.spec.scope.line;
    const message =
      r.verdictReason && r.verdictReason.length > 0
        ? `${r.spec.name}: ${r.verdictReason}`.slice(0, 500)
        : r.spec.name;

    out.push({
      id: r.spec.id,
      file,
      line,
      severity: sev,
      category: `test-case-fail-${r.spec.category}`,
      message,
      snippet: r.evidence.snippet,
      expectedBehavior: r.evidence.expectedBehavior ?? r.spec.then,
      actualBehavior: r.evidence.actualBehavior ?? r.verdictReason,
    });
  }

  // Stable sort by severity desc, then file path, then line.
  out.sort((a, b) => {
    const sd = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sd !== 0) return sd;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  return out;
}

/**
 * Read structured TestCaseResult[] from `<cwd>/.zerou/test-results.json` if
 * it exists, else return [].
 */
export function readTestResultsFile(cwd: string): TestCaseResult[] {
  const p = path.join(cwd, '.zerou', 'test-results.json');
  try {
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Light shape check — only keep entries with a recognisable spec + status.
    return parsed.filter((x): x is TestCaseResult => {
      if (!x || typeof x !== 'object') return false;
      const rec = x as Record<string, unknown>;
      const spec = rec.spec as Record<string, unknown> | undefined;
      const status = rec.status;
      if (!spec || typeof spec !== 'object') return false;
      if (typeof spec.id !== 'string') return false;
      if (typeof status !== 'string') return false;
      return ['pass', 'fail', 'inconclusive', 'skipped'].includes(status);
    });
  } catch {
    return [];
  }
}
