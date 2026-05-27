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
import { writeEnhanceReport, defaultDiffFetcher } from './enhance/report.js';
import { writeEnhanceHtmlReport } from './enhance/html-report.js';
import { testFailsToFindings, readTestResultsFile } from './enhance/test-fail-to-finding.js';

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

  // Compact per-module status lines, flushed at end (8-10 lines max).
  // Each entry is one rendered row in the final summary block.
  const moduleLines: string[] = [];
  const pushModule = (icon: '✅' | '➖' | '❌' | '⚠', label: string, note: string): void => {
    moduleLines.push(`${icon} ${label.padEnd(14)} ${note}`);
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
  writeOut(`─────────────────────────────────\n`);

  // ── Read existing audit findings (optional) ──────────────────────────────
  const findings = readAuditFindings(targetCwd, logger);

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
      const plan = await planLogInjection({ cwd: worktreePath, framework, logger });
      result.modules.logPlanner = plan;
      const exec = await executeLogInjection({ cwd: worktreePath, plan, logger });
      result.modules.logExecutor = exec;
      const note = exec.filesChanged.length === 0
        ? `0 sites (logger ${plan.loggerLib})`
        : `${plan.sites.length} sites → ${exec.filesChanged.length} files`;
      pushModule(exec.failures.length > 0 ? '⚠' : '✅', 'Logging', note);
    } catch (e) {
      logCatch(logger, 'enhance.log.error', e);
      pushModule('⚠', 'Logging', `errored: ${(e as Error).message}`);
    }
  } else {
    pushModule('➖', 'Logging', 'skipped (--skip-log)');
  }

  // Module C: bug patcher
  if (!skipBugs && findings.length > 0) {
    try {
      const patches = await patchBugs({
        cwd: worktreePath,
        findings,
        criticConfig,
        criticApiKey,
        logger,
      });
      result.modules.bugPatcher = patches;
      const applied = patches.filter((p) => p.status === 'applied').length;
      pushModule(applied > 0 ? '✅' : '➖', 'Bug fix', `${applied}/${patches.length} patches`);
    } catch (e) {
      logCatch(logger, 'enhance.bugs.error', e);
      pushModule('⚠', 'Bug fix', `errored: ${(e as Error).message}`);
    }
  } else {
    pushModule('➖', 'Bug fix', findings.length === 0 ? '0 findings' : 'skipped');
  }

  // Module D: health endpoint
  if (!skipHealth) {
    try {
      const h = await addHealthEndpoint({ cwd: worktreePath, framework, logger });
      result.modules.healthGen = h;
      pushModule(h.added ? '✅' : '➖', 'Health', h.added ? `+ ${h.added}` : `skipped (${h.reason ?? '?'})`);
    } catch (e) {
      logCatch(logger, 'enhance.health.error', e);
      pushModule('⚠', 'Health', `errored: ${(e as Error).message}`);
    }
  } else {
    pushModule('➖', 'Health', 'skipped (--skip-health)');
  }

  // Module E: sentry
  if (!skipSentry) {
    try {
      const s = await installSentry({ cwd: worktreePath, framework, logger });
      result.modules.sentryInstaller = s;
      const note = s.added.length === 0 && s.dependencies.length === 0
        ? 'already tracked'
        : `${s.added.length} files + ${s.dependencies.length} deps`;
      pushModule(s.added.length > 0 ? '✅' : '➖', 'Sentry', note);
    } catch (e) {
      logCatch(logger, 'enhance.sentry.error', e);
      pushModule('⚠', 'Sentry', `errored: ${(e as Error).message}`);
    }
  } else {
    pushModule('➖', 'Sentry', 'skipped (--skip-sentry)');
  }

  // Module F: env
  if (!skipEnv) {
    try {
      const env = await completeEnvExample({ cwd: worktreePath, logger });
      result.modules.envCompleter = env;
      pushModule(env.added.length > 0 ? '✅' : '➖', '.env',
        env.added.length > 0 ? `+${env.added.length} var${env.added.length === 1 ? '' : 's'}` : 'no changes');
    } catch (e) {
      logCatch(logger, 'enhance.env.error', e);
      pushModule('⚠', '.env', `errored: ${(e as Error).message}`);
    }
  } else {
    pushModule('➖', '.env', 'skipped (--skip-env)');
  }

  // ── Verification ─────────────────────────────────────────────────────────
  try {
    const verify = await verifyEnhancedCode({
      cwd: worktreePath,
      skipBuild,
      logger,
      timeoutMs: 600_000,
    });
    result.verify = verify;
    const stepLabels = verify.steps.map((s) => `${s.status === 'pass' ? '✅' : s.status === 'fail' ? '❌' : '➖'} ${s.name}`);
    pushModule(verify.ok ? '✅' : '❌', 'Verify', stepLabels.join(' · '));
  } catch (e) {
    logCatch(logger, 'enhance.verify.error', e);
    pushModule('⚠', 'Verify', `errored: ${(e as Error).message}`);
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
      } else {
        const errOut = (commit.stderr || commit.stdout || 'unknown').slice(0, 500);
        logBranch(logger, 'enhance.commit-decision', {
          decision: 'failed',
          reasoning: errOut,
        });
        pushModule('⚠', 'Commit', errOut.slice(0, 80));
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
  const zerouDir = path.join(targetCwd, '.zerou');
  const runArchiveDir = path.join(zerouDir, 'runs', ts);
  fs.mkdirSync(runArchiveDir, { recursive: true });

  const archivedMdPath = path.join(runArchiveDir, 'enhance-report.md');
  const archivedHtmlPath = path.join(runArchiveDir, 'enhance-report.html');
  const stableMdPath = path.join(zerouDir, 'enhance-report.md');
  const stableHtmlPath = path.join(zerouDir, 'enhance-report.html');

  // Write canonical markdown to the archived run directory first, then copy.
  try {
    await writeEnhanceReport({ cwd: targetCwd, reportPath: archivedMdPath, result, logger });
    fs.copyFileSync(archivedMdPath, stableMdPath);
  } catch (e) {
    logCatch(logger, 'enhance.report.error', e);
    pushModule('⚠', 'Report', `md error: ${(e as Error).message}`);
  }

  // Live-append HTML report into the archive, then copy to stable path.
  try {
    let diffs: import('./enhance/types.js').FileDiff[] | null = null;
    let diffError: string | null = null;
    try {
      diffs = await defaultDiffFetcher(worktreePath);
    } catch (err) {
      diffError = err instanceof Error ? err.message : String(err);
    }
    // Read test-results.json so findings table can show patched/rejected rows.
    const testResults = readTestResultsFile(targetCwd);
    await writeEnhanceHtmlReport({
      reportPath: archivedHtmlPath,
      project: path.basename(targetCwd) || 'project',
      result,
      diffs,
      diffError,
      testResults,
      // Use a sibling-relative link so the markdown link resolves next to the html.
      markdownPath: 'enhance-report.md',
      logger,
    });
    fs.copyFileSync(archivedHtmlPath, stableHtmlPath);
  } catch (e) {
    logCatch(logger, 'enhance.html.error', e);
    pushModule('⚠', 'Report', `html error: ${(e as Error).message}`);
  }

  // ── Compact 8-10 line summary ────────────────────────────────────────────
  for (const line of moduleLines) writeOut(`${line}\n`);
  writeOut(`─────────────────────────────────\n`);
  writeOut(`📄 ${toFileUri(stableHtmlPath)}\n`);
  writeOut(`   open with: zerou review\n`);
  writeOut(`   merge:     git merge --no-ff ${branch}\n`);
  if (noColor) {
    // currently a no-op flag retained for backwards compat; explicit acknowledgement.
  }

  logger.log('info', 'enhance.complete', {
    durationMs: result.durationMs,
    verifyOk: result.verify?.ok ?? false,
    branch,
    archiveDir: runArchiveDir,
  });
  await logger.flush();
  return result.verify?.ok === false ? 1 : 0;
}

function toFileUri(p: string): string {
  const norm = p.replace(/\\/g, '/');
  return norm.startsWith('/') ? `file://${norm}` : `file:///${norm}`;
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
  // Phase 11.3: union of TWO sources:
  //   1. <cwd>/.zerou/audit-report.md  →  Static Hardening Findings table
  //   2. <cwd>/.zerou/test-results.json →  LLM-judge test-case fails
  //
  // Static findings + test-case fails are merged, then de-duped by
  // (file, line, message). Bug-patcher classifies each via the extended
  // classifyFinding() that knows the `test-case-fail-<category>` taxonomy.
  const findings: AuditFinding[] = [];
  const reportPath = path.join(targetCwd, '.zerou', 'audit-report.md');

  if (fs.existsSync(reportPath)) {
    try {
      const text = fs.readFileSync(reportPath, 'utf8');
      const sectionMatch = text.match(
        /<!-- section:static-findings start -->([\s\S]*?)<!-- section:static-findings end -->/,
      );
      if (sectionMatch) {
        const body = sectionMatch[1] ?? '';
        const rowRe = /^\|\s*([^|]+?)\s*\|\s*([^|]+?):(\d+)\s*\|\s*(P\d)\s*\|\s*([^|]+?)\s*\|\s*$/gm;
        let m: RegExpExecArray | null;
        while ((m = rowRe.exec(body))) {
          const [, id, file, line, severity, verdict] = m;
          if (id === 'Finding') continue;
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
    } catch (e) {
      logCatch(logger, 'enhance.audit-findings-decision', e);
    }
  } else {
    logBranch(logger, 'enhance.audit-findings-decision', {
      decision: 'no-prior-audit-md',
      reasoning: `${reportPath} missing`,
    });
  }
  const staticCount = findings.length;

  // ── Test-case-fail findings (Phase 11.3) ──────────────────────────────────
  const results = readTestResultsFile(targetCwd);
  const testFindings = testFailsToFindings({ results, minSeverity: 'P3' });
  const seen = new Set<string>();
  for (const f of findings) {
    seen.add(`${f.file}|${f.line}|${f.message}`);
  }
  let testAdded = 0;
  for (const tf of testFindings) {
    const key = `${tf.file}|${tf.line}|${tf.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(tf);
    testAdded++;
  }

  logBranch(logger, 'enhance.audit-findings-decision', {
    decision: 'parsed',
    reasoning: `static=${staticCount} + test-case-fail=${testAdded} = ${findings.length}`,
    count: findings.length,
    staticCount,
    testFailCount: testAdded,
  });
  return findings;
}
