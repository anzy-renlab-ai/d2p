/**
 * Phase 10 — `zerou enhance` orchestrator.
 *
 * Authority: docs/plans/2026-05-27-phase-10-enhance.md
 *
 * Flow:
 *   1. Resolve config + critic engine (mirror audit.ts)
 *   2. Detect project framework (reuse detectProject)
 *   3. Create git worktree .worktrees/zerou-enhance-{ts}/
 *   4. Read .zerou/audit-report.md findings (optional)
 *   5. Run planners (read-only) in parallel
 *   6. Run executors (write) sequentially
 *   7. Run verification harness
 *   8. Write enhance-report.md
 *   9. Print user-facing summary
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import { engineFamily } from './stubs.js';
import { loadConfig, providerForKind, resolveKeyForProvider } from './config.js';
import type { EngineConfig } from './stubs.js';
import { createTrackLogger } from './log-types.js';
import { logBranch, logCatch } from './log/branch.js';
import { detectProject } from './agent/project-detector.js';

import type {
  Framework,
  AuditFinding,
  EnhanceFlowResult,
} from './enhance/types.js';
import { planLogInjection } from './enhance/log-planner.js';
import { executeLogInjection } from './enhance/log-executor.js';
import { patchBugs } from './enhance/bug-patcher.js';
import { addHealthEndpoint } from './enhance/health-gen.js';
import { installSentry } from './enhance/sentry-installer.js';
import { completeEnvExample } from './enhance/env-completer.js';
import { verifyEnhancedCode } from './enhance/verify.js';
import { writeEnhanceReport } from './enhance/report.js';

export interface EnhanceCliOpts {
  argv: string[];
}

export async function runEnhance(opts: EnhanceCliOpts): Promise<number> {
  // Parse args:  zerou enhance <path> [--config <file>] [--no-color] [--skip-build] [--skip-bugs] [--skip-log]
  const args = opts.argv.slice(3);
  let cwdArg: string | undefined;
  let configPath: string | undefined;
  let skipBuild = false;
  let skipBugs = false;
  let skipLog = false;
  let skipSentry = false;
  let skipHealth = false;
  let skipEnv = false;
  let noColor = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--config' && i + 1 < args.length) {
      configPath = args[++i];
    } else if (a === '--skip-build') skipBuild = true;
    else if (a === '--skip-bugs') skipBugs = true;
    else if (a === '--skip-log') skipLog = true;
    else if (a === '--skip-sentry') skipSentry = true;
    else if (a === '--skip-health') skipHealth = true;
    else if (a === '--skip-env') skipEnv = true;
    else if (a === '--no-color') noColor = true;
    else if (!a.startsWith('--') && !cwdArg) cwdArg = a;
  }

  const targetCwd = path.resolve(cwdArg ?? process.cwd());
  const startedAt = new Date();

  const writeOut = (s: string): void => {
    process.stdout.write(s);
  };

  if (!fs.existsSync(targetCwd)) {
    writeOut(`zerou enhance: path does not exist: ${targetCwd}\n`);
    return 2;
  }

  // ── Resolve config (simplified — pick first criticPool entry + env key) ──
  let criticConfig: EngineConfig | null = null;
  let criticApiKey: string | null = null;
  try {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
    const loaded = loadConfig({ configPath, homeDir, logger: undefined as never });
    const first = loaded.cfg.criticPool?.[0];
    if (first) {
      criticConfig = { ...first } as EngineConfig;
      const provider = providerForKind(first.kind);
      const key = resolveKeyForProvider(provider, new Map(), process.env, loaded.cfg.keys ?? {});
      if (key) {
        criticApiKey = key;
        criticConfig = { ...criticConfig, apiKey: key };
      }
    }
  } catch {
    // No config — bug-patcher will simply skip all findings.
  }

  // ── Setup logger ──────────────────────────────────────────────────────────
  const logRoot = path.join(targetCwd, '.zerou', 'logs');
  fs.mkdirSync(logRoot, { recursive: true });
  const logger = createTrackLogger('agent', { logRoot });
  logger.log('info', 'enhance.start', {
    cwd: targetCwd,
    critic: criticConfig ? engineFamily(criticConfig) : 'none',
    skip: { build: skipBuild, bugs: skipBugs, log: skipLog, sentry: skipSentry, health: skipHealth, env: skipEnv },
  });

  // ── Detect project ────────────────────────────────────────────────────────
  const profile = await detectProject({ cwd: targetCwd, logger, criticConfig, criticApiKey });
  const framework = inferFramework(profile.framework);
  logBranch(logger, 'enhance.framework-decision', {
    decision: framework,
    reasoning: `detected from project profile: ${profile.framework}`,
  });

  // ── Setup worktree ────────────────────────────────────────────────────────
  const ts = formatTs(startedAt);
  const branch = `zerou-enhance-${ts}`;
  const worktreeRoot = path.join(targetCwd, '.worktrees');
  const worktreePath = path.join(worktreeRoot, branch);

  const worktreeResult = setupWorktree(targetCwd, worktreePath, branch, logger);
  if (!worktreeResult.ok) {
    writeOut(`\n❌ Failed to set up worktree: ${worktreeResult.error}\n`);
    if (worktreeResult.error?.includes('not a git repository')) {
      writeOut(`Hint: run 'git init' in ${targetCwd} first.\n`);
    }
    return 3;
  }

  writeOut(`zerou enhance ${targetCwd}\n`);
  writeOut(`Worktree:  ${worktreePath}\n`);
  writeOut(`Branch:    ${branch}\n`);
  writeOut(`Framework: ${framework}\n\n`);

  // ── Read existing audit findings (optional) ──────────────────────────────
  const findings = readAuditFindings(targetCwd, logger);
  if (findings.length > 0) {
    writeOut(`Found ${findings.length} audit findings from prior \`zerou audit\` run.\n\n`);
  } else if (!skipBugs) {
    writeOut(`No prior audit findings (looked for .zerou/audit-report.md). Bug-patcher will be a no-op.\n\n`);
  }

  // ── Run modules ──────────────────────────────────────────────────────────
  const result: EnhanceFlowResult = {
    worktreePath,
    branch,
    modules: {},
    durationMs: 0,
    startedAt: startedAt.toISOString(),
  };

  // Module A/B: log injection
  if (!skipLog) {
    try {
      writeOut(`▶ Module A/B: log injection planning…\n`);
      const plan = await planLogInjection({ cwd: worktreePath, framework, logger });
      result.modules.logPlanner = plan;
      writeOut(`  Logger: ${plan.loggerLib}, ${plan.sites.length} sites planned\n`);

      writeOut(`▶ Module B:   log injection executing…\n`);
      const exec = await executeLogInjection({ cwd: worktreePath, plan, logger });
      result.modules.logExecutor = exec;
      writeOut(`  Changed ${exec.filesChanged.length} files; ${exec.failures.length} failures\n\n`);
    } catch (e) {
      logCatch(logger, 'enhance.log.error', e);
      writeOut(`  ⚠ log module errored: ${(e as Error).message}\n\n`);
    }
  }

  // Module C: bug patcher
  if (!skipBugs && findings.length > 0) {
    try {
      writeOut(`▶ Module C:   bug auto-patch (${findings.length} findings)…\n`);
      const patches = await patchBugs({
        cwd: worktreePath,
        findings,
        criticConfig,
        criticApiKey,
        logger,
      });
      result.modules.bugPatcher = patches;
      const applied = patches.filter((p) => p.status === 'applied').length;
      const skipped = patches.filter((p) => p.status === 'skipped').length;
      const failed = patches.filter((p) => p.status === 'failed').length;
      writeOut(`  Applied ${applied} / skipped ${skipped} / failed ${failed}\n\n`);
    } catch (e) {
      logCatch(logger, 'enhance.bugs.error', e);
      writeOut(`  ⚠ bug-patcher errored: ${(e as Error).message}\n\n`);
    }
  }

  // Module D: health endpoint
  if (!skipHealth) {
    try {
      writeOut(`▶ Module D:   health endpoint…\n`);
      const h = await addHealthEndpoint({ cwd: worktreePath, framework, logger });
      result.modules.healthGen = h;
      writeOut(`  ${h.added ? '✅ created ' + h.added : '➖ skipped (' + (h.reason ?? '?') + ')'}\n\n`);
    } catch (e) {
      logCatch(logger, 'enhance.health.error', e);
      writeOut(`  ⚠ health-gen errored: ${(e as Error).message}\n\n`);
    }
  }

  // Module E: sentry
  if (!skipSentry) {
    try {
      writeOut(`▶ Module E:   sentry SDK install…\n`);
      const s = await installSentry({ cwd: worktreePath, framework, logger });
      result.modules.sentryInstaller = s;
      writeOut(
        s.added.length === 0
          ? `  ➖ skipped (tracker already present or no deps to add)\n\n`
          : `  ✅ added ${s.added.length} files + ${s.dependencies.length} deps\n\n`,
      );
    } catch (e) {
      logCatch(logger, 'enhance.sentry.error', e);
      writeOut(`  ⚠ sentry-installer errored: ${(e as Error).message}\n\n`);
    }
  }

  // Module F: env
  if (!skipEnv) {
    try {
      writeOut(`▶ Module F:   .env.example completion…\n`);
      const env = await completeEnvExample({ cwd: worktreePath, logger });
      result.modules.envCompleter = env;
      writeOut(`  Added ${env.added.length} vars; ${env.unusedRemoved.length} declared-but-unused\n\n`);
    } catch (e) {
      logCatch(logger, 'enhance.env.error', e);
      writeOut(`  ⚠ env-completer errored: ${(e as Error).message}\n\n`);
    }
  }

  // ── Verification ─────────────────────────────────────────────────────────
  writeOut(`▶ Module G:   verifying (install + tsc + test${skipBuild ? '' : ' + build'})…\n`);
  try {
    const verify = await verifyEnhancedCode({
      cwd: worktreePath,
      skipBuild,
      logger,
      timeoutMs: 600_000,
    });
    result.verify = verify;
    for (const step of verify.steps) {
      const glyph = step.status === 'pass' ? '✅' : step.status === 'fail' ? '❌' : '➖';
      const secs = (step.durationMs / 1000).toFixed(1);
      writeOut(`  ${glyph} ${step.name.padEnd(8)} ${secs}s${step.status === 'fail' ? ` (exit ${step.exitCode})` : ''}\n`);
    }
    writeOut(`  ${verify.ok ? '✅ all verification passed' : '❌ verification failed' + (verify.brokenBy ? ' (broken by ' + verify.brokenBy + ')' : '')}\n\n`);
  } catch (e) {
    logCatch(logger, 'enhance.verify.error', e);
    writeOut(`  ⚠ verify errored: ${(e as Error).message}\n\n`);
  }

  // ── Auto-commit changes to worktree branch ────────────────────────────────
  // So `git diff main..HEAD` shows the work and the branch is mergeable.
  try {
    const status = spawnSync('git', ['status', '--porcelain'], {
      cwd: worktreePath,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (status.status === 0 && status.stdout.trim().length > 0) {
      spawnSync('git', ['add', '-A'], {
        cwd: worktreePath,
        shell: process.platform === 'win32',
      });
      const msg = [
        'chore: zerou enhance pass',
        '',
        `Modules run:`,
        result.modules.logExecutor
          ? `- log injection: ${result.modules.logExecutor.filesChanged.length} files`
          : null,
        result.modules.bugPatcher && result.modules.bugPatcher.length > 0
          ? `- bug patches: ${result.modules.bugPatcher.filter((p) => p.status === 'applied').length} applied`
          : null,
        result.modules.healthGen?.added ? `- health endpoint: ${result.modules.healthGen.added}` : null,
        result.modules.sentryInstaller && result.modules.sentryInstaller.added.length > 0
          ? `- sentry: ${result.modules.sentryInstaller.added.length} files`
          : null,
        result.modules.envCompleter && result.modules.envCompleter.added.length > 0
          ? `- .env.example: +${result.modules.envCompleter.added.length} vars`
          : null,
        '',
        `Verify: ${result.verify?.ok ? 'PASS' : 'FAIL'}`,
        '',
        `Branch: ${branch}`,
      ]
        .filter(Boolean)
        .join('\n');
      // --no-verify: enhance commits live in a transient worktree the user
      // reviews before merging; the user's pre-commit hook will run on their
      // actual merge into main. Module G already did our own verification.
      // We compress the multi-line message to single-line `-m` segments per arg
      // because some shells (Windows) mishandle embedded newlines in argv.
      const msgLines = msg.split('\n');
      const commitArgs: string[] = [
        '-c', 'user.email=zerou@local',
        '-c', 'user.name=ZeroU',
        'commit', '--no-verify', '-q',
      ];
      for (const line of msgLines) commitArgs.push('-m', line);
      const commit = spawnSync('git', commitArgs, {
        cwd: worktreePath,
        encoding: 'utf8',
        // shell:false on purpose — multi-line -m args get mangled by cmd.exe
        // when shell:true. git.exe is on PATH so direct spawn works.
        shell: false,
      });
      if (commit.status === 0) {
        logBranch(logger, 'enhance.commit-decision', {
          decision: 'committed',
          reasoning: 'auto-committed enhance changes to worktree branch (--no-verify)',
        });
        writeOut(`📌 Committed all changes to branch ${branch}\n`);
      } else {
        const errOut = (commit.stderr || commit.stdout || 'unknown').slice(0, 500);
        logBranch(logger, 'enhance.commit-decision', {
          decision: 'failed',
          reasoning: errOut,
        });
        writeOut(`⚠ auto-commit failed: ${errOut.slice(0, 200)}\n`);
        writeOut(`  Use 'git -C ${worktreePath} status' to see staged changes.\n`);
      }
    } else {
      logBranch(logger, 'enhance.commit-decision', {
        decision: 'skipped',
        reasoning: 'no changes detected by git status',
      });
    }
  } catch (e) {
    logCatch(logger, 'enhance.commit-decision', e);
  }

  // ── Report ───────────────────────────────────────────────────────────────
  result.durationMs = Date.now() - startedAt.getTime();
  const reportPath = path.join(targetCwd, '.zerou', 'enhance-report.md');
  try {
    await writeEnhanceReport({ cwd: targetCwd, reportPath, result, logger });
    writeOut(`📄 Report:  ${reportPath}\n`);
  } catch (e) {
    logCatch(logger, 'enhance.report.error', e);
    writeOut(`  ⚠ report errored: ${(e as Error).message}\n`);
  }

  // ── User-facing instructions ─────────────────────────────────────────────
  writeOut(`\n${noColor ? '' : ''}Next steps:\n`);
  writeOut(`  cd ${worktreePath}\n`);
  writeOut(`  git diff main..HEAD          # review changes\n`);
  writeOut(`  cd ${targetCwd}\n`);
  writeOut(`  git merge --no-ff ${branch}  # accept changes\n`);
  writeOut(`  # or:  git worktree remove ${worktreePath}  # drop changes\n`);

  logger.log('info', 'enhance.complete', {
    durationMs: result.durationMs,
    verifyOk: result.verify?.ok ?? false,
    branch,
  });
  await logger.flush();
  return result.verify?.ok === false ? 1 : 0;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function inferFramework(raw: string): Framework {
  const v = (raw ?? '').toLowerCase();
  if (v.includes('next')) return 'next.js';
  if (v.includes('express')) return 'express';
  if (v.includes('fastify')) return 'fastify';
  if (v.includes('koa')) return 'koa';
  if (v.includes('nest')) return 'nest.js';
  return 'unknown';
}

function formatTs(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function setupWorktree(
  targetCwd: string,
  worktreePath: string,
  branch: string,
  logger: ReturnType<typeof createTrackLogger>,
): { ok: true } | { ok: false; error: string } {
  // Verify it's a git repo first
  const isGit = spawnSync('git', ['rev-parse', '--git-dir'], {
    cwd: targetCwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (isGit.status !== 0) {
    logBranch(logger, 'enhance.worktree-decision', {
      decision: 'not-git',
      reasoning: 'git rev-parse failed; not a git repository',
    });
    return { ok: false, error: 'not a git repository' };
  }
  // If worktree path already exists, fail
  if (fs.existsSync(worktreePath)) {
    return { ok: false, error: `worktree path already exists: ${worktreePath}` };
  }
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  // Determine base branch (main, master, or current HEAD)
  let baseRef = 'HEAD';
  for (const candidate of ['main', 'master']) {
    const probe = spawnSync('git', ['rev-parse', '--verify', candidate], {
      cwd: targetCwd,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (probe.status === 0) {
      baseRef = candidate;
      break;
    }
  }
  // Create worktree with new branch
  const add = spawnSync(
    'git',
    ['worktree', 'add', '-b', branch, worktreePath, baseRef],
    {
      cwd: targetCwd,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    },
  );
  if (add.status !== 0) {
    return { ok: false, error: (add.stderr || add.stdout || 'git worktree add failed').slice(0, 500) };
  }
  logBranch(logger, 'enhance.worktree-decision', {
    decision: 'created',
    reasoning: `git worktree add -b ${branch} ${worktreePath} ${baseRef}`,
    worktreePath,
    branch,
    baseRef,
  });
  return { ok: true };
}

function readAuditFindings(
  targetCwd: string,
  logger: ReturnType<typeof createTrackLogger>,
): AuditFinding[] {
  // For v1 we ONLY read the structured findings from the audit-report.md table.
  // The richer test-case results (LLM-judge fail entries) are in logs but
  // require parsing event streams; defer to v2.
  const reportPath = path.join(targetCwd, '.zerou', 'audit-report.md');
  if (!fs.existsSync(reportPath)) {
    logBranch(logger, 'enhance.audit-findings-decision', {
      decision: 'no-prior-audit',
      reasoning: `${reportPath} missing`,
    });
    return [];
  }
  try {
    const text = fs.readFileSync(reportPath, 'utf8');
    const findings: AuditFinding[] = [];
    // Parse Static Hardening Findings table:
    //   | Finding | Location | Severity | Verdict |
    const sectionMatch = text.match(
      /<!-- section:static-findings start -->([\s\S]*?)<!-- section:static-findings end -->/,
    );
    if (sectionMatch) {
      const body = sectionMatch[1] ?? '';
      const rowRe = /^\|\s*([^|]+?)\s*\|\s*([^|]+?):(\d+)\s*\|\s*(P\d)\s*\|\s*([^|]+?)\s*\|\s*$/gm;
      let m: RegExpExecArray | null;
      while ((m = rowRe.exec(body))) {
        const [, id, file, line, severity, verdict] = m;
        if (id === 'Finding') continue; // header row
        if (verdict?.trim() === 'false-positive') continue;
        findings.push({
          id: id!.trim(),
          file: file!.trim(),
          line: parseInt(line!, 10),
          severity: severity as 'P1' | 'P2' | 'P3',
          category: 'unknown',
          message: id!.trim(),
        });
      }
    }
    logBranch(logger, 'enhance.audit-findings-decision', {
      decision: 'parsed',
      reasoning: `parsed ${findings.length} findings from ${reportPath}`,
      count: findings.length,
    });
    return findings;
  } catch (e) {
    logCatch(logger, 'enhance.audit-findings-decision', e);
    return [];
  }
}
