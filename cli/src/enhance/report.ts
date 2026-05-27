/**
 * Phase 10 — Module H: enhance report writer.
 *
 * After all six executor modules (A/B/C/D/E/F) and Module G verification
 * have completed, this module renders a single markdown report describing:
 *   - What changed (log sites injected, bugs patched, health endpoint,
 *     sentry SDK, .env.example deltas)
 *   - Whether verification (install/tsc/test/build) passed
 *   - How the user inspects + merges or drops the worktree
 *
 * Unlike `agent/progressive-report.ts` (audit-time streaming), this is a
 * one-shot writer: the enhance flow is much shorter and the user only
 * reads the report after everything is done.
 *
 * Decision-branch log taxonomy: `enhance.report.*`
 *   - enhance.report.start
 *   - enhance.report.section-skipped
 *   - enhance.report.complete
 *
 * Authority:
 *   docs/plans/2026-05-27-phase-10-enhance.md §"模块契约"
 *   cli/src/enhance/types.ts (shared types)
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type {
  EnhanceFlowResult,
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

// ── Public entry point ──────────────────────────────────────────────────────

export async function writeEnhanceReport(opts: ReportOpts): Promise<void> {
  const { reportPath, result, logger, cwd } = opts;

  logger.log('info', 'enhance.report.start', { reportPath });

  const md = renderReport(cwd, result);
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
  });
}

// ── Top-level renderer ──────────────────────────────────────────────────────

/** Pure renderer (no I/O). Exported for tests. */
export function renderReport(cwd: string, result: EnhanceFlowResult): string {
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

  // How to review
  lines.push('## How to review');
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

  lines.push('## 6. Module G — Verification');
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
  formatDuration,
  statusGlyph,
};
