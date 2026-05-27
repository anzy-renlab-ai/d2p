/**
 * Phase 10 — Module H: enhance report writer.
 *
 * After all six executor modules (A/B/C/D/E/F) and Module G verification
 * have completed, this module renders a single markdown report describing:
 *   - What changed (log sites injected, bugs patched, health endpoint,
 *     sentry SDK, .env.example deltas)
 *   - Whether verification (install/tsc/test/build) passed
 *   - The full per-file unified diff inline so the user does not need to
 *     run `git diff main..HEAD` themselves
 *   - How the user inspects + merges or drops the worktree
 *
 * Unlike `agent/progressive-report.ts` (audit-time streaming), this is a
 * one-shot writer: the enhance flow is much shorter and the user only
 * reads the report after everything is done.
 *
 * Decision-branch log taxonomy: `enhance.report.*`
 *   - enhance.report.start
 *   - enhance.report.section-skipped
 *   - enhance.report.diff-fetch-decision
 *   - enhance.report.diff-omitted
 *   - enhance.report.complete
 *
 * Authority:
 *   docs/plans/2026-05-27-phase-10-enhance.md §"模块契约"
 *   cli/src/enhance/types.ts (shared types)
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type {
  DiffFetcher,
  EnhanceFlowResult,
  FileDiff,
  FileDiffStatus,
  HealthGenResult,
  InjectionPlan,
  LogSite,
  PatchResult,
  ReportOpts,
  SentryInstallResult,
  EnvCompleteResult,
  VerifyResult,
  VerifyStep,
} from './types.js';
import { logBranch, logCatch } from '../log/branch.js';

// ── Tunables for inline diff rendering ─────────────────────────────────────

/** Hard byte cap above which a single file's diff is fully elided. */
const DIFF_BYTES_CAP = 50 * 1024;
/** Soft line cap above which we render head + tail with an elision marker. */
const DIFF_LINES_CAP = 200;
/** Head/tail size when eliding. */
const DIFF_HEAD_LINES = 100;
const DIFF_TAIL_LINES = 100;
/** Files whose diffs we never inline (always-noise generated artifacts). */
const ALWAYS_OMIT_FILES = new Set<string>([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
]);

// ── Public entry point ──────────────────────────────────────────────────────

export async function writeEnhanceReport(opts: ReportOpts): Promise<void> {
  const { reportPath, result, logger, cwd } = opts;

  logger.log('info', 'enhance.report.start', { reportPath });

  // Fetch diffs (best-effort). Failures degrade gracefully — we still emit
  // a report so the user always has *something*.
  const fetcher: DiffFetcher = opts.diffFetcher ?? defaultDiffFetcher;
  let diffs: FileDiff[] | null = null;
  let diffError: string | null = null;
  try {
    diffs = await fetcher(result.worktreePath);
    logBranch(logger, 'enhance.report.diff-fetch-decision', {
      decision: 'fetched',
      fileCount: diffs.length,
    });
  } catch (err) {
    diffError = err instanceof Error ? err.message : String(err);
    logCatch(logger, 'enhance.report.diff-fetch-error', err, {
      worktreePath: result.worktreePath,
    });
  }

  const md = renderReport(cwd, result, { diffs, diffError });
  const bytes = Buffer.byteLength(md, 'utf8');

  try {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, md, 'utf8');
  } catch (err) {
    logCatch(logger, 'enhance.report.write-error', err, { reportPath });
    throw err;
  }

  logger.log('info', 'enhance.report.complete', {
    reportPath,
    bytesWritten: bytes,
    diffFiles: diffs?.length ?? 0,
    diffError,
  });
}

// ── Top-level renderer ──────────────────────────────────────────────────────

export interface RenderExtras {
  diffs?: FileDiff[] | null;
  diffError?: string | null;
}

/** Pure renderer (no I/O). Exported for tests. */
export function renderReport(
  cwd: string,
  result: EnhanceFlowResult,
  extras: RenderExtras = {},
): string {
  const lines: string[] = [];

  const verify = result.verify;
  const verifyStatusLine = verify
    ? verify.ok
      ? 'PASS'
      : `FAIL${result.verify?.brokenBy ? ` (broken by ${result.verify.brokenBy})` : ''}`
    : 'not run';

  const projectName = path.basename(cwd) || 'project';

  lines.push('# ZeroU Enhance Report');
  lines.push('');
  lines.push(`**Project**: ${projectName}`);
  lines.push(`**Branch**: ${result.branch}`);
  lines.push(`**Worktree**: ${result.worktreePath}`);
  lines.push(`**Generated**: ${result.startedAt}`);
  lines.push(`**Duration**: ${formatDuration(result.durationMs)}`);
  lines.push(`**Verify**: ${verifyStatusLine}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  for (const l of renderSummaryBullets(result)) lines.push(l);
  lines.push('');

  // Files changed TOC (glanceable, with intra-doc anchor links)
  lines.push(...renderFilesChangedToc(extras.diffs ?? null));
  lines.push('');

  // How to review — diffs are now inline below, but keep the commands
  // available for users who want to use a different viewer.
  lines.push('## How to review');
  lines.push('');
  lines.push(
    'The full unified diff is included inline below. The commands below ' +
      'are reference only — use them if you prefer a different viewer ' +
      '(IDE, `git difftool`, GitHub etc.).',
  );
  lines.push('');
  lines.push('```bash');
  lines.push(`cd ${result.worktreePath}`);
  lines.push('git diff main..HEAD');
  lines.push('# Satisfied? merge:');
  lines.push(`cd ${cwd}`);
  lines.push(`git merge --no-ff ${result.branch}`);
  lines.push('# Not satisfied? drop:');
  lines.push(`git worktree remove ${result.worktreePath}`);
  lines.push('```');
  lines.push('');

  // Module sections — always render the heading; body is "(skipped — module
  // did not run)" if the module is absent. This keeps the report's section
  // numbering predictable.
  lines.push('## 1. Module A/B — Log injection');
  lines.push('');
  lines.push(
    ...renderLogInjectionSection(
      result.modules.logPlanner,
      result.modules.logExecutor,
    ),
  );
  lines.push('');

  lines.push('## 2. Module C — Bug fix patches');
  lines.push('');
  lines.push(...renderBugPatchSection(result.modules.bugPatcher));
  lines.push('');

  lines.push('## 3. Module D — Health endpoint');
  lines.push('');
  lines.push(...renderHealthSection(result.modules.healthGen));
  lines.push('');

  lines.push('## 4. Module E — Sentry SDK');
  lines.push('');
  lines.push(...renderSentrySection(result.modules.sentryInstaller));
  lines.push('');

  lines.push('## 5. Module F — .env.example');
  lines.push('');
  lines.push(...renderEnvSection(result.modules.envCompleter));
  lines.push('');

  // Inline full diff section (sits BEFORE Verify so it's visible right
  // after the per-module summaries).
  lines.push(...renderInlineDiffSection(extras.diffs ?? null, extras.diffError ?? null, result.worktreePath));
  lines.push('');

  lines.push('## 7. Module G — Verification');
  lines.push('');
  lines.push(...renderVerifySection(verify));
  lines.push('');

  // Logs pointer
  lines.push('## Logs');
  lines.push('');
  lines.push(`Full decision-event log: \`${cwd}/.zerou/logs/\``);
  lines.push(
    `Tail key events: \`tail -F ${cwd}/.zerou/logs/agent/<latest>.jsonl\``,
  );
  lines.push('');

  return lines.join('\n');
}

// ── Section: Summary ────────────────────────────────────────────────────────

function renderSummaryBullets(result: EnhanceFlowResult): string[] {
  const out: string[] = [];
  const exec = result.modules.logExecutor;
  const plan = result.modules.logPlanner;

  // Log injection
  if (plan || exec) {
    const sitesPlanned = plan?.sites.length ?? 0;
    const filesChanged = exec?.filesChanged.length ?? 0;
    out.push(
      `- Log injection: ${sitesPlanned} sites planned across ${filesChanged} files changed`,
    );
  } else {
    out.push('- Log injection: (skipped)');
  }

  // Bug patches
  const patches = result.modules.bugPatcher ?? [];
  if (patches.length > 0) {
    const applied = patches.filter((p) => p.status === 'applied').length;
    const skipped = patches.filter((p) => p.status === 'skipped').length;
    const failed = patches.filter((p) => p.status === 'failed').length;
    out.push(
      `- Bugs auto-patched: ${applied} of ${patches.length} findings ` +
        `(skipped ${skipped}, failed ${failed})`,
    );
  } else {
    out.push('- Bugs auto-patched: 0 findings considered');
  }

  // Health
  const health = result.modules.healthGen;
  if (!health) {
    out.push('- Health endpoint: (skipped)');
  } else if (health.added) {
    out.push(`- Health endpoint: added \`${health.added}\``);
  } else {
    out.push(`- Health endpoint: skipped (${health.reason ?? 'no-action'})`);
  }

  // Sentry
  const sentry = result.modules.sentryInstaller;
  if (!sentry) {
    out.push('- Sentry SDK: (skipped)');
  } else if (sentry.added.length > 0 || sentry.dependencies.length > 0) {
    out.push(
      `- Sentry SDK: added (deps: ${
        sentry.dependencies.length > 0 ? sentry.dependencies.join(', ') : 'none'
      })`,
    );
  } else {
    out.push('- Sentry SDK: already-tracked');
  }

  // env-completer
  const env = result.modules.envCompleter;
  if (!env) {
    out.push('- .env.example: (skipped)');
  } else {
    out.push(
      `- .env.example: ${env.added.length} vars added` +
        (env.existed.length > 0
          ? ` (${env.existed.length} already declared)`
          : ''),
    );
  }

  return out;
}

// ── Section: Files Changed TOC ──────────────────────────────────────────────

function renderFilesChangedToc(diffs: FileDiff[] | null): string[] {
  if (!diffs) {
    // Diff fetcher unavailable / errored. Don't render a header for an
    // empty list — the inline-diff section will explain the situation.
    return [];
  }
  const out: string[] = [];
  out.push(`## Files Changed (${diffs.length})`);
  out.push('');
  if (diffs.length === 0) {
    out.push('_No file changes detected between `main` and `HEAD`._');
    return out;
  }
  for (const d of diffs) {
    const anchor = fileAnchor(d.file);
    const counts = `+${d.additions}, -${d.deletions}`;
    const tag = statusTag(d.status);
    const renameNote =
      d.status === 'renamed' && d.oldFile ? ` (was \`${d.oldFile}\`)` : '';
    out.push(`- [\`${d.file}\`](#${anchor}) — ${counts}${tag}${renameNote}`);
  }
  return out;
}

function statusTag(status: FileDiffStatus): string {
  if (status === 'added') return ' (new)';
  if (status === 'deleted') return ' (deleted)';
  if (status === 'renamed') return ' (renamed)';
  return '';
}

/**
 * GitHub-style anchor slug for a file path. Lower-cases, replaces any
 * non-alphanumeric run with a single dash, strips leading/trailing dashes.
 *
 * Examples:
 *   "src/index.ts"        -> "srcindexts"  (no — GitHub keeps dots!)
 *   "app/api/route.ts"    -> "appapiroutets"
 *
 * Markdown renderers vary; we match GitHub's `slugger` which strips most
 * punctuation but keeps unicode letters + dashes + the `.` is removed.
 * Tests assert that the anchor in the TOC equals the anchor we emit on
 * the heading, so as long as both sides go through this function the
 * cross-link is stable regardless of renderer.
 */
export function fileAnchor(file: string): string {
  return file
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/^-+|-+$/g, '');
}

// ── Section: Log injection (Module A/B) ─────────────────────────────────────

function renderLogInjectionSection(
  plan: InjectionPlan | undefined,
  exec:
    | { filesChanged: string[]; failures: { file: string; reason: string }[] }
    | undefined,
): string[] {
  if (!plan && !exec) {
    return ['_Module did not run._'];
  }
  const out: string[] = [];
  out.push(`**Logger lib**: ${plan?.loggerLib ?? 'unknown'}`);
  out.push(
    `**Bootstrap created**: ${plan?.bootstrapFile ?? '➖ existing / not needed'}`,
  );
  out.push(
    `**Middleware created**: ${plan?.middlewareFile ?? '➖ existing / not needed'}`,
  );
  out.push('');

  // Per-file table from the executor's filesChanged list, joined with site
  // info from the plan.
  if (exec && exec.filesChanged.length > 0) {
    const byFile = new Map<string, LogSite[]>();
    for (const s of plan?.sites ?? []) {
      const list = byFile.get(s.file) ?? [];
      list.push(s);
      byFile.set(s.file, list);
    }
    out.push('| File | Sites changed | Site kinds |');
    out.push('|---|---|---|');
    for (const f of exec.filesChanged) {
      const sites = byFile.get(f) ?? [];
      const kinds = uniq(sites.map((s) => s.kind)).join(', ') || '-';
      out.push(`| \`${f}\` | ${sites.length} | ${kinds} |`);
    }
  } else {
    out.push('_No files changed by log executor._');
  }

  if (exec && exec.failures.length > 0) {
    out.push('');
    out.push('**Failures**:');
    out.push('');
    for (const f of exec.failures) {
      out.push(`- \`${f.file}\`: ${f.reason}`);
    }
  }

  return out;
}

// ── Section: Bug patches (Module C) ─────────────────────────────────────────

function renderBugPatchSection(patches: PatchResult[] | undefined): string[] {
  if (!patches) return ['_Module did not run._'];
  if (patches.length === 0) return ['_No findings to patch._'];

  const out: string[] = [];
  out.push('| Finding | File:line | Severity | Status | Reason |');
  out.push('|---|---|---|---|---|');
  for (const p of patches) {
    const reason = p.reason ?? '-';
    out.push(
      `| ${escapeCell(p.finding.id)} | ${escapeCell(p.finding.file)}:${
        p.finding.line
      } | ${p.finding.severity} | ${p.status} | ${escapeCell(reason)} |`,
    );
  }

  // Per-patch diffs
  const applied = patches.filter((p) => p.status === 'applied' && p.diff);
  if (applied.length > 0) {
    out.push('');
    out.push('### Applied diffs');
    out.push('');
    for (const p of applied) {
      out.push(`#### ${p.finding.id}`);
      out.push('');
      out.push('```diff');
      const lines = (p.diff ?? '').split(/\r?\n/);
      const capped = lines.slice(0, 30);
      out.push(...capped);
      if (lines.length > capped.length) {
        out.push(`...[${lines.length - capped.length} more lines truncated]...`);
      }
      out.push('```');
      out.push('');
    }
  }

  return out;
}

// ── Section: Health (Module D) ──────────────────────────────────────────────

function renderHealthSection(h: HealthGenResult | undefined): string[] {
  if (!h) return ['_Module did not run._'];
  if (h.added) return [`Added health endpoint: \`${h.added}\``];
  return [`Skipped: ${h.reason ?? 'no-action'}`];
}

// ── Section: Sentry (Module E) ──────────────────────────────────────────────

function renderSentrySection(s: SentryInstallResult | undefined): string[] {
  if (!s) return ['_Module did not run._'];
  const out: string[] = [];
  if (s.added.length === 0 && s.dependencies.length === 0) {
    out.push('Already tracked — no changes made.');
    return out;
  }
  if (s.dependencies.length > 0) {
    out.push(`**Dependencies added**: ${s.dependencies.join(', ')}`);
  }
  if (s.added.length > 0) {
    out.push('**Files created**:');
    for (const f of s.added) out.push(`- \`${f}\``);
  }
  if (s.bootstrapPatched) {
    out.push(`**Bootstrap patched**: \`${s.bootstrapPatched}\``);
  }
  return out;
}

// ── Section: .env.example (Module F) ────────────────────────────────────────

function renderEnvSection(e: EnvCompleteResult | undefined): string[] {
  if (!e) return ['_Module did not run._'];
  const out: string[] = [];
  if (e.added.length === 0 && e.existed.length === 0 && e.unusedRemoved.length === 0) {
    return ['No env vars detected in source.'];
  }
  if (e.added.length > 0) {
    out.push(`**Added**: ${e.added.map((v) => `\`${v}\``).join(', ')}`);
  }
  if (e.existed.length > 0) {
    out.push(
      `**Already declared**: ${e.existed.map((v) => `\`${v}\``).join(', ')}`,
    );
  }
  if (e.unusedRemoved.length > 0) {
    out.push(
      `**Unused (declared but not used)**: ${e.unusedRemoved
        .map((v) => `\`${v}\``)
        .join(', ')}`,
    );
  }
  return out;
}

// ── Section: Inline full unified diff ───────────────────────────────────────

function renderInlineDiffSection(
  diffs: FileDiff[] | null,
  diffError: string | null,
  worktreePath: string,
): string[] {
  const out: string[] = [];
  out.push('## 6. Changes (full diff inline)');
  out.push('');

  if (diffError) {
    out.push(
      `> Note: could not fetch diff (${diffError}). ` +
        `Run \`git diff main..HEAD\` manually in \`${worktreePath}\`.`,
    );
    return out;
  }
  if (!diffs) {
    out.push(
      `> Note: diff was not requested for this report. ` +
        `Run \`git diff main..HEAD\` manually in \`${worktreePath}\`.`,
    );
    return out;
  }
  if (diffs.length === 0) {
    out.push('_No file changes between `main` and `HEAD`._');
    return out;
  }

  for (const d of diffs) {
    const counts = `+${d.additions}, -${d.deletions}`;
    const tag = statusTag(d.status);
    const heading = `### \`${d.file}\` (${counts})${tag}`;
    out.push(heading);
    // Manually-controlled anchor so the TOC links match no matter how the
    // markdown renderer slugifies. GitHub's renderer respects an inline
    // <a> with an id sibling.
    out.push(`<a id="${fileAnchor(d.file)}"></a>`);
    if (d.status === 'renamed' && d.oldFile) {
      out.push(`_Renamed from \`${d.oldFile}\`._`);
    }
    out.push('');

    if (d.omittedReason) {
      out.push(`_Diff omitted: ${d.omittedReason}_`);
      out.push('');
      continue;
    }

    const rendered = capDiffForRender(d.unifiedDiff);
    out.push('```diff');
    for (const line of rendered) out.push(line);
    out.push('```');
    out.push('');
  }
  return out;
}

/**
 * Cap a diff for inline rendering:
 *   - >50 KB → return a single-line "[omitted: too large]" placeholder
 *     (the caller should normally have set omittedReason already; this
 *     is a belt-and-braces guard).
 *   - >200 lines → first 100 + `[... N lines omitted ...]` + last 100.
 *   - otherwise → pass-through (trailing newline normalised out).
 */
export function capDiffForRender(unifiedDiff: string): string[] {
  if (Buffer.byteLength(unifiedDiff, 'utf8') > DIFF_BYTES_CAP) {
    return [`[diff omitted: > ${Math.floor(DIFF_BYTES_CAP / 1024)} KB]`];
  }
  // Drop the trailing empty line that splitting "...\n" produces so we
  // don't bake a blank line into the rendered fence.
  const all = unifiedDiff.split(/\r?\n/);
  if (all.length > 0 && all[all.length - 1] === '') all.pop();

  if (all.length <= DIFF_LINES_CAP) return all;

  const head = all.slice(0, DIFF_HEAD_LINES);
  const tail = all.slice(all.length - DIFF_TAIL_LINES);
  const omitted = all.length - head.length - tail.length;
  return [...head, `[... ${omitted} lines omitted ...]`, ...tail];
}

// ── Section: Verify (Module G) ──────────────────────────────────────────────

function renderVerifySection(v: VerifyResult | undefined): string[] {
  if (!v) return ['_Module did not run._'];

  const out: string[] = [];
  out.push('| Step | Status | Duration | Notes |');
  out.push('|---|---|---|---|');
  for (const step of v.steps) {
    out.push(
      `| ${step.name} | ${statusGlyph(step.status)} | ${formatDuration(
        step.durationMs,
      )} | ${formatStepNotes(step)} |`,
    );
  }

  if (!v.ok && v.brokenBy) {
    out.push('');
    out.push(`**Broken by**: ${v.brokenBy}`);
  }

  // Tail stderr from failed steps to help debugging.
  const failedSteps = v.steps.filter((s) => s.status === 'fail');
  if (failedSteps.length > 0) {
    out.push('');
    out.push('### Failed step output');
    out.push('');
    for (const step of failedSteps) {
      out.push(`#### ${step.name}`);
      out.push('');
      out.push('```');
      const tail = lastLines(step.stderr || step.stdout, 30);
      out.push(tail || '(no output)');
      out.push('```');
      out.push('');
    }
  }

  return out;
}

// ── Default diff fetcher ────────────────────────────────────────────────────

/**
 * Run `git -C <worktreePath> diff <base>..HEAD --name-status` to enumerate
 * changed files, then `git -C ... diff <base>..HEAD -- <file>` per file to
 * fetch the full unified diff. Falls back from `main` → `master` →
 * `HEAD~1` if the base ref doesn't resolve.
 *
 * NEVER passes `shell: true` for git — git is on PATH; running it through
 * the shell opens us to argument-quoting surprises in worktrees whose
 * paths contain spaces.
 */
export const defaultDiffFetcher: DiffFetcher = async (worktreePath) => {
  const base = await resolveBase(worktreePath);
  if (!base) {
    throw new Error(
      `no diff base found in ${worktreePath} (tried main, master, HEAD~1)`,
    );
  }

  // Enumerate changed files with their status code.
  const nameStatus = await runGit(
    ['-C', worktreePath, 'diff', `${base}..HEAD`, '--name-status', '-M'],
    worktreePath,
  );
  if (nameStatus.exitCode !== 0) {
    throw new Error(
      `git diff --name-status failed (exit ${nameStatus.exitCode}): ${nameStatus.stderr.trim()}`,
    );
  }

  const entries = parseNameStatus(nameStatus.stdout);
  const out: FileDiff[] = [];
  for (const entry of entries) {
    const targetFile = entry.file;
    const isLockfile = ALWAYS_OMIT_FILES.has(path.basename(targetFile));

    // Fetch numstat for additions/deletions.
    const numstat = await runGit(
      ['-C', worktreePath, 'diff', `${base}..HEAD`, '--numstat', '-M', '--', entry.oldFile ?? targetFile, targetFile],
      worktreePath,
    );
    const [additions, deletions] = parseNumstat(numstat.stdout);

    if (isLockfile) {
      out.push({
        file: targetFile,
        oldFile: entry.oldFile,
        status: entry.status,
        additions,
        deletions,
        unifiedDiff: '',
        omittedReason: 'lockfile / generated artifact',
      });
      continue;
    }

    // Fetch the full unified diff for this file.
    const fileDiff = await runGit(
      ['-C', worktreePath, 'diff', `${base}..HEAD`, '-M', '--', entry.oldFile ?? targetFile, targetFile],
      worktreePath,
    );
    if (fileDiff.exitCode !== 0) {
      out.push({
        file: targetFile,
        oldFile: entry.oldFile,
        status: entry.status,
        additions,
        deletions,
        unifiedDiff: '',
        omittedReason: `git diff failed (exit ${fileDiff.exitCode})`,
      });
      continue;
    }

    const diffText = fileDiff.stdout;
    const bytes = Buffer.byteLength(diffText, 'utf8');
    if (bytes > DIFF_BYTES_CAP) {
      out.push({
        file: targetFile,
        oldFile: entry.oldFile,
        status: entry.status,
        additions,
        deletions,
        unifiedDiff: '',
        omittedReason: `diff > ${Math.floor(DIFF_BYTES_CAP / 1024)} KB (${bytes} bytes)`,
      });
      continue;
    }

    out.push({
      file: targetFile,
      oldFile: entry.oldFile,
      status: entry.status,
      additions,
      deletions,
      unifiedDiff: diffText,
    });
  }
  return out;
};

async function resolveBase(worktreePath: string): Promise<string | null> {
  for (const candidate of ['main', 'master']) {
    const r = await runGit(
      ['-C', worktreePath, 'rev-parse', '--verify', '--quiet', candidate],
      worktreePath,
    );
    if (r.exitCode === 0 && r.stdout.trim().length > 0) return candidate;
  }
  const head1 = await runGit(
    ['-C', worktreePath, 'rev-parse', '--verify', '--quiet', 'HEAD~1'],
    worktreePath,
  );
  if (head1.exitCode === 0 && head1.stdout.trim().length > 0) return 'HEAD~1';
  return null;
}

interface NameStatusEntry {
  status: FileDiffStatus;
  file: string;
  oldFile?: string;
}

export function parseNameStatus(stdout: string): NameStatusEntry[] {
  const out: NameStatusEntry[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Tab-separated. R/C entries carry a similarity score (e.g. R100).
    const parts = line.split(/\t/);
    const code = parts[0] ?? '';
    if (code.startsWith('R') && parts.length >= 3) {
      const oldFile = parts[1];
      const file = parts[2];
      if (oldFile && file) out.push({ status: 'renamed', oldFile, file });
      continue;
    }
    if (code.startsWith('C') && parts.length >= 3) {
      // Copy — treat as added (the target file is new content).
      const oldFile = parts[1];
      const file = parts[2];
      if (oldFile && file) out.push({ status: 'added', oldFile, file });
      continue;
    }
    const file = parts[1];
    if (!file) continue;
    if (code === 'A') out.push({ status: 'added', file });
    else if (code === 'D') out.push({ status: 'deleted', file });
    else if (code === 'M' || code === 'T') out.push({ status: 'modified', file });
    else out.push({ status: 'modified', file });
  }
  return out;
}

function parseNumstat(stdout: string): [number, number] {
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d+|-)\s+(\d+|-)\s+/);
    if (!m) continue;
    const addRaw = m[1] ?? '0';
    const delRaw = m[2] ?? '0';
    const a = addRaw === '-' ? 0 : parseInt(addRaw, 10);
    const d = delRaw === '-' ? 0 : parseInt(delRaw, 10);
    return [a, d];
  }
  return [0, 0];
}

interface GitResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runGit(args: string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    // shell:false because git.exe is on PATH and our args may contain
    // worktree paths with spaces; quoting through cmd.exe is brittle.
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (c) => stdoutChunks.push(Buffer.from(c)));
    child.stderr?.on('data', (c) => stderrChunks.push(Buffer.from(c)));
    child.on('error', (err) => {
      resolve({
        exitCode: 127,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
      });
    });
    child.on('close', (code) => {
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
  });
}

// ── Small helpers ───────────────────────────────────────────────────────────

function statusGlyph(s: VerifyStep['status']): string {
  if (s === 'pass') return '✅';
  if (s === 'fail') return '❌';
  return '➖';
}

function formatStepNotes(step: VerifyStep): string {
  if (step.status === 'skipped') {
    const firstLine = (step.stdout || '').split(/\r?\n/)[0] ?? '';
    return escapeCell(firstLine.replace(/^\[verify\]\s*/, '').trim() || '-');
  }
  if (step.status === 'fail') {
    const errLines = (step.stderr || '').split(/\r?\n/).filter((l) => l.trim());
    const tail = errLines[errLines.length - 1] ?? '';
    return escapeCell(tail.slice(0, 120) || 'failed');
  }
  return '-';
}

function lastLines(s: string, n: number): string {
  if (!s) return '';
  const lines = s.split(/\r?\n/);
  return lines.slice(-n).join('\n');
}

function escapeCell(s: string): string {
  if (!s) return '-';
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

/** Format millis as "Xm Ys" or "Ys" if under a minute. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

// ── Exported test helpers ───────────────────────────────────────────────────

export const __internals = {
  renderSummaryBullets,
  renderLogInjectionSection,
  renderBugPatchSection,
  renderHealthSection,
  renderSentrySection,
  renderEnvSection,
  renderVerifySection,
  renderInlineDiffSection,
  renderFilesChangedToc,
  formatDuration,
  statusGlyph,
  fileAnchor,
  capDiffForRender,
  parseNameStatus,
  DIFF_BYTES_CAP,
  DIFF_LINES_CAP,
};
