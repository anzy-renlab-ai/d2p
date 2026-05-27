/**
 * Phase 12 — ReviewBundle builder.
 *
 * Consolidates every `.zerou/*` artifact (enhance-report.md, test-results.json,
 * branch-coverage.json, audit-report.md, decision-event logs, worktree git
 * diff) into a single JSON document the `zerou review` React UI consumes.
 *
 * Pure aggregation: this module NEVER writes to .zerou/ except when the user
 * explicitly calls `writeReviewBundle`.
 *
 * Tactically: the enhance flow's structured `EnhanceFlowResult` lives only in
 * memory during the run. Once it ends, the on-disk evidence is the markdown
 * report + a small handful of JSON files. We parse the markdown back into
 * structure here. This is brittle on purpose — when the markdown contract
 * changes, both this and the writer must change together.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { defaultDiffFetcher } from './enhance/report.js';
import type { DiffFetcher, FileDiff } from './enhance/types.js';
import { readTestResultsFile } from './enhance/test-fail-to-finding.js';
import type { TestCaseResult, TestCaseCategory } from './agent/types.js';
import type { BranchCoverageReport } from './agent/branch-coverage-types.js';
import {
  MODULE_LABELS,
  type ReviewAudit,
  type ReviewBundle,
  type ReviewFile,
  type ReviewFileStatus,
  type ReviewFinding,
  type ReviewFindingStatus,
  type ReviewModule,
  type ReviewModuleId,
  type ReviewModuleStatus,
  type ReviewSeverity,
  type ReviewVerify,
  type ReviewVerifyStep,
  type VerifyStepName,
} from './review-data-types.js';

// ── Public surface ──────────────────────────────────────────────────────────

export interface BuildBundleOpts {
  /** Optional explicit run timestamp (e.g. '20260527-182708'). Default: latest. */
  runTs?: string;
  /** Inject a diff fetcher for tests. Defaults to {@link defaultDiffFetcher}. */
  diffFetcher?: DiffFetcher;
  /** Optional logger sink for non-fatal warnings. Default: silent. */
  onWarn?: (event: string, detail?: unknown) => void;
}

/**
 * Build a ReviewBundle from on-disk artifacts under `<cwd>/.zerou/`.
 *
 * The function NEVER throws on missing inputs — it degrades gracefully and
 * fills affected sections with empty arrays / sentinel objects, mirroring the
 * EMPTY_BUNDLE_SENTINEL contract.
 */
export async function buildReviewBundle(
  cwd: string,
  opts: BuildBundleOpts = {},
): Promise<ReviewBundle> {
  const zerouDir = path.join(cwd, '.zerou');
  const onWarn = opts.onWarn ?? ((): void => {});
  const generatedAt = new Date().toISOString();
  const projectName = readProjectName(cwd);

  // ── Locate run (latest by default) ────────────────────────────────────────
  const runTs = opts.runTs ?? findLatestRunTs(zerouDir);
  const archivedMd = runTs
    ? path.join(zerouDir, 'runs', runTs, 'enhance-report.md')
    : null;
  const stableMd = path.join(zerouDir, 'enhance-report.md');
  // Prefer the per-run archive (immutable); fall back to the stable copy.
  const mdPath =
    archivedMd && fs.existsSync(archivedMd)
      ? archivedMd
      : fs.existsSync(stableMd)
        ? stableMd
        : null;

  const md = mdPath ? safeRead(mdPath) : '';
  const header = parseHeader(md);

  // Project block (always populated even if no run exists yet).
  const project = {
    name: projectName,
    cwd: path.resolve(cwd),
    branch: header.branch ?? '',
    worktreePath: header.worktreePath ?? '',
    runTs: runTs ?? header.runTs ?? '',
  };

  // ── No run found → return sentinel-shaped bundle ─────────────────────────
  if (!mdPath) {
    const audit = parseAudit(zerouDir);
    return {
      version: 1,
      project,
      generatedAt,
      durationMs: 0,
      modules: [],
      files: [],
      findings: [],
      branchCoverage: loadBranchCoverage(zerouDir, onWarn),
      verify: { ok: false, steps: [] },
      audit,
    };
  }

  // ── Modules + verify from markdown ────────────────────────────────────────
  const modules = parseModules(md);
  const verify = parseVerify(md);

  // ── File diffs (best-effort) ─────────────────────────────────────────────
  // When the caller injects a fetcher (tests do this), trust it unconditionally
  // — the injection IS the seam. Only fall through to the existence check when
  // we're using the real shelling-out fetcher.
  let files: ReviewFile[] = [];
  const usingInjectedFetcher = !!opts.diffFetcher;
  const fetcher: DiffFetcher = opts.diffFetcher ?? defaultDiffFetcher;
  const canFetch =
    usingInjectedFetcher ||
    (project.worktreePath !== '' && fs.existsSync(project.worktreePath));
  if (canFetch) {
    try {
      const diffs = await fetcher(project.worktreePath);
      files = diffs.map((d) => toReviewFile(d, modules));
    } catch (err) {
      onWarn('review-data.diff-fetch-failed', {
        worktreePath: project.worktreePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (project.worktreePath) {
    onWarn('review-data.worktree-missing', { worktreePath: project.worktreePath });
  }

  // ── Findings: bug-patcher table (status-rich) + un-patched test fails ────
  const findings = buildFindings(md, zerouDir);

  // ── Audit summary ─────────────────────────────────────────────────────────
  const audit = parseAudit(zerouDir);

  return {
    version: 1,
    project,
    generatedAt,
    durationMs: header.durationMs ?? 0,
    modules,
    files,
    findings,
    branchCoverage: loadBranchCoverage(zerouDir, onWarn),
    verify,
    audit,
  };
}

/**
 * Write the bundle to two paths:
 *   - `<cwd>/.zerou/review-bundle.json`      — stable (latest)
 *   - `<cwd>/.zerou/runs/<runTs>/review-bundle.json` — archived per-run
 *
 * Returns the absolute path of the stable copy.
 */
export function writeReviewBundle(
  cwd: string,
  bundle: ReviewBundle,
  runTs: string,
): string {
  const zerouDir = path.join(cwd, '.zerou');
  const stable = path.join(zerouDir, 'review-bundle.json');
  fs.mkdirSync(zerouDir, { recursive: true });
  const json = JSON.stringify(bundle, null, 2);
  fs.writeFileSync(stable, json, 'utf8');
  if (runTs) {
    const archDir = path.join(zerouDir, 'runs', runTs);
    fs.mkdirSync(archDir, { recursive: true });
    fs.writeFileSync(path.join(archDir, 'review-bundle.json'), json, 'utf8');
  }
  return stable;
}

// ── Project name ────────────────────────────────────────────────────────────

function readProjectName(cwd: string): string {
  const pkgPath = path.join(cwd, 'package.json');
  try {
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg && typeof pkg.name === 'string' && pkg.name.length > 0) {
        return String(pkg.name);
      }
    }
  } catch {
    // fall through
  }
  return path.basename(path.resolve(cwd)) || 'project';
}

// ── Locate latest run ───────────────────────────────────────────────────────

function findLatestRunTs(zerouDir: string): string | null {
  const runsDir = path.join(zerouDir, 'runs');
  if (!fs.existsSync(runsDir)) return null;
  try {
    const entries = fs.readdirSync(runsDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    // Run timestamps are lexicographically sortable: YYYYMMDD-HHMMSS.
    dirs.sort();
    return dirs.length > 0 ? dirs[dirs.length - 1]! : null;
  } catch {
    return null;
  }
}

// ── Read helpers ────────────────────────────────────────────────────────────

function safeRead(p: string): string {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

// ── Parse: header ──────────────────────────────────────────────────────────

interface ReportHeader {
  branch?: string;
  worktreePath?: string;
  startedAt?: string;
  durationMs?: number;
  runTs?: string;
}

function parseHeader(md: string): ReportHeader {
  if (!md) return {};
  const branch = matchOne(md, /^\*\*Branch\*\*:\s*(.+)$/m);
  const worktree = matchOne(md, /^\*\*Worktree\*\*:\s*(.+)$/m);
  const generated = matchOne(md, /^\*\*Generated\*\*:\s*(.+)$/m);
  const duration = matchOne(md, /^\*\*Duration\*\*:\s*(.+)$/m);
  // Run ts is the timestamp suffix on the branch name `zerou-enhance-<ts>`.
  const ts = branch?.match(/zerou-enhance-(\d{8}-\d{6})/)?.[1];
  return {
    branch: branch?.trim(),
    worktreePath: worktree?.trim(),
    startedAt: generated?.trim(),
    durationMs: duration ? parseDuration(duration.trim()) : undefined,
    runTs: ts,
  };
}

function matchOne(s: string, re: RegExp): string | undefined {
  return s.match(re)?.[1];
}

/** Inverse of report.ts `formatDuration` ('1m 23s' / '45s'). */
export function parseDuration(s: string): number {
  const m = s.match(/^(?:(\d+)m\s+)?(\d+)s$/);
  if (!m) return 0;
  const mins = m[1] ? parseInt(m[1], 10) : 0;
  const secs = parseInt(m[2]!, 10);
  return (mins * 60 + secs) * 1000;
}

// ── Parse: modules ─────────────────────────────────────────────────────────

function parseModules(md: string): ReviewModule[] {
  if (!md) return [];
  const out: ReviewModule[] = [];

  // Log injection (Module A/B) — count files in "Files Changed" table
  const log = parseLogInjectionSection(md);
  out.push({
    id: 'logging',
    label: MODULE_LABELS.logging,
    status: log.status,
    summary: log.summary,
    filesTouched: log.filesTouched,
    details: log.details,
  });

  // Bug patch (Module C)
  const bug = parseBugPatchSection(md);
  out.push({
    id: 'bug-patch',
    label: MODULE_LABELS['bug-patch'],
    status: bug.status,
    summary: bug.summary,
    filesTouched: bug.filesTouched,
    details: bug.details,
  });

  // Health (Module D)
  const health = parseHealthSection(md);
  out.push({
    id: 'health',
    label: MODULE_LABELS.health,
    status: health.status,
    summary: health.summary,
    filesTouched: health.filesTouched,
    details: health.details,
  });

  // Sentry (Module E)
  const sentry = parseSentrySection(md);
  out.push({
    id: 'sentry',
    label: MODULE_LABELS.sentry,
    status: sentry.status,
    summary: sentry.summary,
    filesTouched: sentry.filesTouched,
    details: sentry.details,
  });

  // env (Module F)
  const env = parseEnvSection(md);
  out.push({
    id: 'env',
    label: MODULE_LABELS.env,
    status: env.status,
    summary: env.summary,
    filesTouched: env.filesTouched,
    details: env.details,
  });

  // Verify (Module G) — derive status from step rows
  const verify = parseVerify(md);
  const verifyStatus: ReviewModuleStatus = verify.steps.length === 0
    ? 'skipped'
    : verify.ok
      ? 'ok'
      : 'failed';
  out.push({
    id: 'verify',
    label: MODULE_LABELS.verify,
    status: verifyStatus,
    summary: verify.steps.length === 0
      ? 'not run'
      : verify.steps.map((s) => `${s.name}:${s.status}`).join(', '),
    filesTouched: 0,
    details: { ok: verify.ok, steps: verify.steps },
  });

  return out;
}

interface ParsedModule {
  status: ReviewModuleStatus;
  summary: string;
  filesTouched: number;
  details?: Record<string, unknown>;
}

function parseLogInjectionSection(md: string): ParsedModule {
  const body = sliceSection(md, '## 1. Module A/B — Log injection');
  if (!body || /Module did not run/.test(body)) {
    return { status: 'skipped', summary: 'not run', filesTouched: 0 };
  }
  const loggerLib = matchOne(body, /^\*\*Logger lib\*\*:\s*(.+)$/m)?.trim() ?? 'unknown';
  // Per-file table rows: `| `path` | N | kinds |`
  const fileRows = Array.from(
    body.matchAll(/^\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|/gm),
  );
  const filesTouched = fileRows.length;
  return {
    status: filesTouched > 0 ? 'ok' : 'skipped',
    summary:
      filesTouched > 0
        ? `${filesTouched} files (${loggerLib})`
        : `no sites (${loggerLib})`,
    filesTouched,
    details: { loggerLib, files: fileRows.map((m) => m[1]) },
  };
}

function parseBugPatchSection(md: string): ParsedModule {
  const body = sliceSection(md, '## 2. Module C — Bug fix patches');
  if (!body || /No findings to patch|Module did not run/.test(body)) {
    return { status: 'skipped', summary: '0 findings', filesTouched: 0 };
  }
  // Table rows: `| id | path:line | sev | status | reason |`
  const rows = Array.from(
    body.matchAll(
      /^\|\s*([^|]+?)\s*\|\s*([^|]+?):(\d+)\s*\|\s*(P\d)\s*\|\s*(applied|skipped|failed)\s*\|\s*([^|]+?)\s*\|$/gm,
    ),
  );
  // Filter header row whose status cell literally reads 'Status'.
  const data = rows.filter((m) => m[5] !== 'Status');
  const applied = data.filter((m) => m[5] === 'applied').length;
  const skipped = data.filter((m) => m[5] === 'skipped').length;
  const failed = data.filter((m) => m[5] === 'failed').length;
  const total = data.length;
  const status: ReviewModuleStatus =
    total === 0
      ? 'skipped'
      : applied === 0
        ? 'failed'
        : failed > 0 || skipped > 0
          ? 'partial'
          : 'ok';
  return {
    status,
    summary: `${applied}/${total} applied (skipped ${skipped}, failed ${failed})`,
    filesTouched: applied,
    details: { applied, skipped, failed, total },
  };
}

function parseHealthSection(md: string): ParsedModule {
  const body = sliceSection(md, '## 3. Module D — Health endpoint');
  if (!body || /Module did not run/.test(body)) {
    return { status: 'skipped', summary: 'not run', filesTouched: 0 };
  }
  const added = matchOne(body, /Added health endpoint:\s*`([^`]+)`/);
  if (added) {
    return {
      status: 'ok',
      summary: `added ${added}`,
      filesTouched: 1,
      details: { addedFile: added },
    };
  }
  const reason = matchOne(body, /Skipped:\s*(.+)$/m)?.trim() ?? 'no-action';
  return { status: 'skipped', summary: `skipped (${reason})`, filesTouched: 0 };
}

function parseSentrySection(md: string): ParsedModule {
  const body = sliceSection(md, '## 4. Module E — Sentry SDK');
  if (!body || /Module did not run/.test(body)) {
    return { status: 'skipped', summary: 'not run', filesTouched: 0 };
  }
  if (/Already tracked/.test(body)) {
    return { status: 'skipped', summary: 'already tracked', filesTouched: 0 };
  }
  const files = Array.from(body.matchAll(/^-\s*`([^`]+)`$/gm)).map((m) => m[1]!);
  const deps = matchOne(body, /\*\*Dependencies added\*\*:\s*(.+)$/m)?.trim();
  return {
    status: files.length > 0 || deps ? 'ok' : 'skipped',
    summary:
      files.length > 0
        ? `${files.length} files + ${deps ? deps.split(/,\s*/).length : 0} deps`
        : 'no changes',
    filesTouched: files.length,
    details: { files, dependencies: deps ?? '' },
  };
}

function parseEnvSection(md: string): ParsedModule {
  const body = sliceSection(md, '## 5. Module F — .env.example');
  if (!body || /Module did not run/.test(body)) {
    return { status: 'skipped', summary: 'not run', filesTouched: 0 };
  }
  if (/No env vars detected/.test(body)) {
    return { status: 'skipped', summary: 'no env vars detected', filesTouched: 0 };
  }
  const added = matchOne(body, /\*\*Added\*\*:\s*(.+)$/m);
  const existed = matchOne(body, /\*\*Already declared\*\*:\s*(.+)$/m);
  const addedCount = added ? added.match(/`[^`]+`/g)?.length ?? 0 : 0;
  const existedCount = existed ? existed.match(/`[^`]+`/g)?.length ?? 0 : 0;
  return {
    status: addedCount > 0 ? 'ok' : 'skipped',
    summary:
      addedCount > 0
        ? `+${addedCount} var${addedCount === 1 ? '' : 's'}`
        : 'no changes',
    filesTouched: addedCount > 0 ? 1 : 0,
    details: { added: addedCount, existed: existedCount },
  };
}

// ── Parse: verify ──────────────────────────────────────────────────────────

function parseVerify(md: string): ReviewVerify {
  const body = sliceSection(md, '## 7. Module G — Verification');
  if (!body || /Module did not run/.test(body)) {
    return { ok: false, steps: [] };
  }
  // Table row: `| step | ✅|❌|➖ | Xm Ys | notes |`
  // The notes column can be `-` or contain real text. We capture all four.
  const stepRe =
    /^\|\s*(install|tsc|test|build)\s*\|\s*(✅|❌|➖)\s*\|\s*([0-9ms\s]+?)\s*\|\s*([^|]*?)\s*\|$/gm;
  const steps: ReviewVerifyStep[] = [];
  let m: RegExpExecArray | null;
  while ((m = stepRe.exec(body))) {
    const name = m[1] as VerifyStepName;
    const glyph = m[2]!;
    const dur = parseDuration(m[3]!.trim());
    const notes = m[4]!.trim();
    const status: ReviewVerifyStep['status'] =
      glyph === '✅' ? 'pass' : glyph === '❌' ? 'fail' : 'skipped';
    const step: ReviewVerifyStep = {
      name,
      status,
      durationMs: dur,
    };
    if (status === 'fail' && notes && notes !== '-') {
      step.failOutput = notes.slice(0, 4000);
    }
    steps.push(step);
  }
  // Failed-step output blocks (### install/tsc/test/build → ```text```)
  for (const step of steps) {
    if (step.status !== 'fail') continue;
    const blockRe = new RegExp(
      `^####\\s+${step.name}\\s*\\n\\s*\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\``,
      'm',
    );
    const block = body.match(blockRe);
    if (block && block[1]) {
      step.failOutput = block[1].slice(0, 4000);
    }
  }
  const ok = steps.length > 0 && steps.every((s) => s.status !== 'fail');
  const brokenBy = matchOne(body, /\*\*Broken by\*\*:\s*(.+)$/m)?.trim();
  const result: ReviewVerify = { ok, steps };
  if (brokenBy) result.brokenBy = brokenBy;
  return result;
}

// ── Parse: findings ─────────────────────────────────────────────────────────

const SEVERITY_FROM_CATEGORY: Record<TestCaseCategory, ReviewSeverity> = {
  'happy-path': 'P3',
  'edge-case': 'P3',
  security: 'P1',
  'error-handling': 'P2',
  auth: 'P1',
  validation: 'P2',
};

function buildFindings(md: string, zerouDir: string): ReviewFinding[] {
  // 1) Read all test-results.json entries (status='fail') as source of truth.
  //    These carry rich evidence + spec metadata.
  // 2) Read the bug-patcher table from enhance-report.md to learn whether the
  //    patcher reached each finding ('applied' / 'skipped' / 'failed').
  // 3) Cross-reference by (id, file, line). Unmatched test-fails get
  //    status='unpatched' with reason='no-patch-yet'.
  //
  // Static hardening findings (audit-report.md "Static Hardening Findings"
  // table) come in via the same enhance-report.md patcher table — their `id`
  // is the static finding id, severity = column 3, category = 'unknown'.
  const testResults = readTestResultsFile(path.dirname(zerouDir));
  const patcherRows = parsePatcherTable(md);

  // Build (key → row) lookup for fast cross-ref.
  const rowsByKey = new Map<string, PatcherRow>();
  for (const r of patcherRows) {
    rowsByKey.set(`${r.id}|${r.file}|${r.line}`, r);
    // also key by id alone for fallback
    if (!rowsByKey.has(`id:${r.id}`)) rowsByKey.set(`id:${r.id}`, r);
  }

  const out: ReviewFinding[] = [];
  const usedRowKeys = new Set<string>();

  // Test-case fails first (richest evidence).
  for (const tr of testResults) {
    if (tr.status !== 'fail') continue;
    const file = tr.evidence.file ?? tr.spec.scope.file;
    const line = tr.evidence.line ?? tr.spec.scope.line;
    const severity = SEVERITY_FROM_CATEGORY[tr.spec.category] ?? 'P3';
    const key = `${tr.spec.id}|${file}|${line}`;
    const row = rowsByKey.get(key) ?? rowsByKey.get(`id:${tr.spec.id}`);
    if (row) {
      usedRowKeys.add(`${row.id}|${row.file}|${row.line}`);
    }
    const f: ReviewFinding = {
      id: tr.spec.id,
      source: 'test-fail',
      severity,
      category: `test-case-fail-${tr.spec.category}`,
      file: posix(file),
      line,
      message:
        tr.verdictReason && tr.verdictReason.length > 0
          ? `${tr.spec.name}: ${tr.verdictReason}`.slice(0, 500)
          : tr.spec.name,
      status: row ? mapPatcherStatus(row.status) : 'unpatched',
      reason: row?.reason ?? 'no-patch-yet',
    };
    if (tr.evidence.expectedBehavior) f.expectedBehavior = tr.evidence.expectedBehavior;
    if (tr.evidence.actualBehavior) f.actualBehavior = tr.evidence.actualBehavior;
    if (tr.evidence.snippet) f.snippet = tr.evidence.snippet;
    out.push(f);
  }

  // Static findings that weren't matched by any test-fail above.
  for (const row of patcherRows) {
    const rk = `${row.id}|${row.file}|${row.line}`;
    if (usedRowKeys.has(rk)) continue;
    out.push({
      id: row.id,
      source: 'static',
      severity: row.severity,
      category: 'unknown',
      file: posix(row.file),
      line: row.line,
      message: row.id,
      status: mapPatcherStatus(row.status),
      reason: row.reason,
    });
  }

  return out;
}

interface PatcherRow {
  id: string;
  file: string;
  line: number;
  severity: ReviewSeverity;
  status: 'applied' | 'skipped' | 'failed';
  reason: string;
}

function parsePatcherTable(md: string): PatcherRow[] {
  const body = sliceSection(md, '## 2. Module C — Bug fix patches');
  if (!body) return [];
  const out: PatcherRow[] = [];
  const rowRe =
    /^\|\s*([^|]+?)\s*\|\s*([^|]+?):(\d+)\s*\|\s*(P\d)\s*\|\s*(applied|skipped|failed)\s*\|\s*([^|]+?)\s*\|$/gm;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(body))) {
    if (m[1] === 'Finding') continue;
    out.push({
      id: m[1]!.trim(),
      file: m[2]!.trim(),
      line: parseInt(m[3]!, 10),
      severity: m[4] as ReviewSeverity,
      status: m[5] as PatcherRow['status'],
      reason: m[6]!.trim(),
    });
  }
  return out;
}

function mapPatcherStatus(s: PatcherRow['status']): ReviewFindingStatus {
  if (s === 'applied') return 'patched';
  return s; // 'skipped' | 'failed'
}

// ── Files: ReviewFile mapping ──────────────────────────────────────────────

const LOGGER_HINTS = [
  /(^|\/)src\/logger\.(t|j)s$/,
  /(^|\/)logger\.(t|j)s$/,
  /(^|\/)lib\/logger\.(t|j)s$/,
];
const HEALTH_HINTS = [/(^|\/)health\/route\.(t|j)s$/, /(^|\/)pages\/api\/health\./];
const SENTRY_HINTS = [/(^|\/)sentry\.[a-z]+\.config\./, /(^|\/)instrumentation\.(t|j)s$/];
const ENV_HINTS = [/(^|\/)\.env\.example$/];

function toReviewFile(d: FileDiff, modules: ReviewModule[]): ReviewFile {
  const p = posix(d.file);
  const moduleIds: ReviewModuleId[] = [];

  if (LOGGER_HINTS.some((r) => r.test(p))) moduleIds.push('logging');
  if (HEALTH_HINTS.some((r) => r.test(p))) moduleIds.push('health');
  if (SENTRY_HINTS.some((r) => r.test(p))) moduleIds.push('sentry');
  if (ENV_HINTS.some((r) => r.test(p))) moduleIds.push('env');

  // If a logger import got added to a non-logger source file, attribute it
  // to the logging module. Cheap heuristic over the unified diff body.
  if (
    moduleIds.length === 0 &&
    /^\+.*(import .*logger|from ['"].*logger['"])/m.test(d.unifiedDiff)
  ) {
    moduleIds.push('logging');
  }

  // If diff added @sentry/* imports, attribute to sentry.
  if (
    !moduleIds.includes('sentry') &&
    /^\+.*@sentry\//m.test(d.unifiedDiff)
  ) {
    moduleIds.push('sentry');
  }

  // package.json gets touched by sentry (deps) and env (scripts) — best-guess.
  if (p === 'package.json') {
    const sentryHit = /^\+.*@sentry\//m.test(d.unifiedDiff);
    if (sentryHit && !moduleIds.includes('sentry')) moduleIds.push('sentry');
  }

  void modules; // reserved for future cross-ref; kept to expose modules to heuristic later.

  const file: ReviewFile = {
    path: p,
    status: d.status as ReviewFileStatus,
    additions: d.additions,
    deletions: d.deletions,
    modules: moduleIds,
    unifiedDiff: d.unifiedDiff,
  };
  if (d.oldFile) file.oldPath = posix(d.oldFile);
  if (d.omittedReason) file.omittedReason = d.omittedReason;
  return file;
}

// ── Audit summary ──────────────────────────────────────────────────────────

function parseAudit(zerouDir: string): ReviewAudit | null {
  const p = path.join(zerouDir, 'audit-report.md');
  if (!fs.existsSync(p)) return null;
  const md = safeRead(p);
  if (!md) return null;
  const duration = matchOne(md, /^-\s*\*\*Duration\*\*:\s*(.+)$/m);
  const findings = matchOne(md, /^-\s*\*\*Findings\*\*:\s*(\d+)\s+total/m);
  // "Tests: 70 total (15 passed, 38 failed, 3 skipped)"
  const testsMatch = md.match(
    /^-\s*\*\*Tests\*\*:\s*(\d+)\s+total\s*\(([^)]+)\)/m,
  );
  let testCases = { total: 0, pass: 0, fail: 0, inconclusive: 0, skipped: 0 };
  if (testsMatch) {
    const total = parseInt(testsMatch[1]!, 10);
    const inside = testsMatch[2]!;
    const parts = inside.split(/\s*,\s*/);
    const pick = (label: string): number => {
      for (const p of parts) {
        const m = p.match(new RegExp(`^(\\d+)\\s+${label}`));
        if (m) return parseInt(m[1]!, 10);
      }
      return 0;
    };
    testCases = {
      total,
      pass: pick('passed'),
      fail: pick('failed'),
      inconclusive: pick('inconclusive'),
      skipped: pick('skipped'),
    };
  }
  return {
    durationMs: duration ? parseDuration(duration.trim()) : 0,
    hardeningFindings: findings ? parseInt(findings, 10) : 0,
    testCases,
  };
}

// ── Branch coverage ─────────────────────────────────────────────────────────

function loadBranchCoverage(
  zerouDir: string,
  onWarn: (event: string, detail?: unknown) => void,
): BranchCoverageReport | null {
  const p = path.join(zerouDir, 'branch-coverage.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as BranchCoverageReport;
  } catch (err) {
    onWarn('review-data.branch-coverage-parse-failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── Section slicer ─────────────────────────────────────────────────────────

/**
 * Return the body between `## <heading>` and the next `## ` heading.
 * Returns null if heading not found.
 */
function sliceSection(md: string, heading: string): string | null {
  const startIdx = md.indexOf(`\n${heading}\n`);
  // Heading may also be at file start (no leading \n).
  const realStart = startIdx >= 0 ? startIdx + 1 : md.startsWith(heading) ? 0 : -1;
  if (realStart < 0) return null;
  const after = md.indexOf('\n## ', realStart + heading.length);
  const end = after < 0 ? md.length : after;
  return md.slice(realStart + heading.length, end).trim();
}

// ── Path normalization ─────────────────────────────────────────────────────

function posix(p: string): string {
  return p.replace(/\\/g, '/');
}

// ── Test seam ──────────────────────────────────────────────────────────────

export const __internals = {
  parseHeader,
  parseModules,
  parseVerify,
  parsePatcherTable,
  parseAudit,
  parseDuration,
  sliceSection,
  posix,
  toReviewFile,
};
