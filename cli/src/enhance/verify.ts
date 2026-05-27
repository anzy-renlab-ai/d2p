/**
 * Phase 10 — Module G: enhance verify harness.
 *
 * After the executor modules (B/C/D/E/F) write changes inside a worktree, this
 * module runs the user's local toolchain (install → tsc → test → build) and
 * reports whether the change set still compiles, type-checks, tests, and
 * builds.
 *
 * Per the dispatch spec: each step is bounded with `child_process.spawn`
 * (NOT spawnSync) plus a setTimeout-based watchdog so a hung script cannot
 * stall the enhance flow. On Windows we set `shell: true` so the system
 * resolves `npm.cmd` / `npx.cmd` / `bun.cmd` / `pnpm.cmd` from PATH the same
 * way `vitest-orchestrator.ts` does.
 *
 * The harness fails early: if `install` fails, downstream `tsc` / `test` /
 * `build` are recorded as `skipped` rather than executed (running tsc with
 * no node_modules just produces noisy false negatives).
 *
 * Decision-branch log taxonomy: `enhance.verify.*`
 *   - enhance.verify.start
 *   - enhance.verify.install-detect-decision
 *   - enhance.verify.install-skip-decision
 *   - enhance.verify.tsconfig-decision
 *   - enhance.verify.test-script-decision
 *   - enhance.verify.build-script-decision
 *   - enhance.verify.step.start
 *   - enhance.verify.step.complete
 *   - enhance.verify.early-exit-decision
 *   - enhance.verify.complete
 *
 * Authority:
 *   docs/plans/2026-05-27-phase-10-enhance.md §"模块契约" / §"Architecture"
 *   cli/src/enhance/types.ts (shared types)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { exec } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type {
  VerifyOpts,
  VerifyResult,
  VerifyStep,
  VerifyStepStatus,
} from './types.js';
import { logBranch, logCatch } from '../log/branch.js';

// ── Tunables ────────────────────────────────────────────────────────────────

const INSTALL_TIMEOUT_MS = 300_000;
const TSC_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 300_000;
const BUILD_TIMEOUT_MS = 300_000;
const SIGTERM_GRACE_MS = 2_000;

/** Cap each captured stream at 4000 chars per VerifyStep contract. */
const STREAM_CAP_CHARS = 4_000;

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Internal seam used by tests to swap out the real `spawn`. Returns a thin
 * Promise<{exitCode, stdout, stderr, signal}> result. Production code uses
 * `defaultSpawnRunner` which delegates to `node:child_process.spawn`.
 */
export type SpawnRunner = (args: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}) => Promise<SpawnRunnerResult>;

export interface SpawnRunnerResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

interface InternalVerifyOpts extends VerifyOpts {
  /** Test seam — override the real spawn. */
  spawnRunner?: SpawnRunner;
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function verifyEnhancedCode(
  opts: InternalVerifyOpts,
): Promise<VerifyResult> {
  const { cwd, logger } = opts;
  const runner = opts.spawnRunner ?? defaultSpawnRunner;

  logger.log('info', 'enhance.verify.start', { cwd });

  const steps: VerifyStep[] = [];

  // Track whether a prior REQUIRED step failed so we can short-circuit later
  // steps. install + tsc are "required-if-runnable"; test/build are
  // run-if-defined, with their result counting toward `ok`.
  let priorFailed = false;
  function maybeSkip(name: VerifyStep['name'], reason: string): VerifyStep {
    logBranch(logger, 'enhance.verify.early-exit-decision', {
      decision: 'skip',
      name,
      reason,
    });
    return {
      name,
      status: 'skipped',
      durationMs: 0,
      stdout: `[verify] skipped: ${reason}\n`,
      stderr: '',
      exitCode: null,
    };
  }

  // 1) install ------------------------------------------------------------
  const installPlan = await planInstall(cwd, logger);
  let installStep: VerifyStep;
  if (installPlan.skip) {
    installStep = {
      name: 'install',
      status: 'skipped',
      durationMs: 0,
      stdout: `[verify] skipped: ${installPlan.skipReason}\n`,
      stderr: '',
      exitCode: null,
    };
  } else {
    installStep = await runStep(
      'install',
      installPlan.command,
      installPlan.args,
      INSTALL_TIMEOUT_MS,
      cwd,
      runner,
      logger,
    );
    if (installStep.status === 'fail') priorFailed = true;
  }
  steps.push(installStep);

  // 2) tsc ----------------------------------------------------------------
  const tsconfigPath = path.join(cwd, 'tsconfig.json');
  const hasTsconfig = await fileExists(tsconfigPath);
  logBranch(logger, 'enhance.verify.tsconfig-decision', {
    decision: hasTsconfig ? 'run' : 'skip',
    tsconfigPath,
  });

  let tscStep: VerifyStep;
  if (!hasTsconfig) {
    tscStep = maybeSkip('tsc', 'no-tsconfig.json');
  } else if (priorFailed) {
    tscStep = maybeSkip('tsc', 'prior-step-failed');
  } else {
    tscStep = await runStep(
      'tsc',
      'npx',
      ['tsc', '--noEmit', '-p', 'tsconfig.json'],
      TSC_TIMEOUT_MS,
      cwd,
      runner,
      logger,
    );
    if (tscStep.status === 'fail') priorFailed = true;
  }
  steps.push(tscStep);

  // 3) test ---------------------------------------------------------------
  const testCmd = await resolveTestCommand(cwd, opts.testScript, logger);
  let testStep: VerifyStep;
  if (!testCmd) {
    testStep = maybeSkip('test', 'no-test-script');
  } else if (priorFailed) {
    testStep = maybeSkip('test', 'prior-step-failed');
  } else {
    testStep = await runStep(
      'test',
      testCmd.command,
      testCmd.args,
      TEST_TIMEOUT_MS,
      cwd,
      runner,
      logger,
    );
    if (testStep.status === 'fail') priorFailed = true;
  }
  steps.push(testStep);

  // 4) build --------------------------------------------------------------
  let buildStep: VerifyStep;
  if (opts.skipBuild) {
    buildStep = maybeSkip('build', 'skipBuild=true');
  } else {
    const buildCmd = await resolveBuildCommand(cwd, opts.buildScript, logger);
    if (!buildCmd) {
      buildStep = maybeSkip('build', 'no-build-script');
    } else if (priorFailed) {
      buildStep = maybeSkip('build', 'prior-step-failed');
    } else {
      buildStep = await runStep(
        'build',
        buildCmd.command,
        buildCmd.args,
        BUILD_TIMEOUT_MS,
        cwd,
        runner,
        logger,
      );
      if (buildStep.status === 'fail') priorFailed = true;
    }
  }
  steps.push(buildStep);

  // Roll-up: ok = no step is in fail state. `skipped` does not count
  // against the result so a project with no tests still verifies clean.
  const passCount = steps.filter((s) => s.status === 'pass').length;
  const failCount = steps.filter((s) => s.status === 'fail').length;
  const skipCount = steps.filter((s) => s.status === 'skipped').length;
  const ok = failCount === 0;

  logger.log('info', 'enhance.verify.complete', {
    ok,
    stepCount: steps.length,
    pass: passCount,
    fail: failCount,
    skipped: skipCount,
  });

  return { ok, steps };
}

// ── Step runner ─────────────────────────────────────────────────────────────

async function runStep(
  name: VerifyStep['name'],
  command: string,
  args: string[],
  timeoutMs: number,
  cwd: string,
  runner: SpawnRunner,
  logger: VerifyOpts['logger'],
): Promise<VerifyStep> {
  const startedAt = Date.now();
  logger.log('info', 'enhance.verify.step.start', {
    name,
    command,
    args,
  });

  let res: SpawnRunnerResult;
  try {
    res = await runner({
      command,
      args,
      cwd,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
      timeoutMs,
    });
  } catch (err) {
    logCatch(logger, 'enhance.verify.step.spawn-error', err, { name, command });
    const durationMs = Date.now() - startedAt;
    const step: VerifyStep = {
      name,
      status: 'fail',
      durationMs,
      stdout: '',
      stderr: `[verify] spawn error: ${err instanceof Error ? err.message : String(err)}\n`,
      exitCode: null,
    };
    logger.log('info', 'enhance.verify.step.complete', {
      name,
      status: step.status,
      durationMs,
      exitCode: step.exitCode,
    });
    return step;
  }

  const durationMs = Date.now() - startedAt;

  let status: VerifyStepStatus;
  if (res.timedOut) {
    status = 'fail';
  } else if (res.spawnError) {
    status = 'fail';
  } else if (res.exitCode === 0) {
    status = 'pass';
  } else {
    status = 'fail';
  }

  // Compose final stdout/stderr — surface timeouts in the captured text so
  // the report shows a clear reason. Cap before logging too.
  let stdout = res.stdout ?? '';
  let stderr = res.stderr ?? '';
  if (res.timedOut) {
    stderr =
      (stderr ? stderr + '\n' : '') +
      `[verify] timed out after ${timeoutMs}ms\n`;
  }
  if (res.spawnError) {
    stderr =
      (stderr ? stderr + '\n' : '') + `[verify] spawn error: ${res.spawnError}\n`;
  }

  const step: VerifyStep = {
    name,
    status,
    durationMs,
    stdout: capStream(stdout),
    stderr: capStream(stderr),
    exitCode: res.exitCode,
  };

  logger.log('info', 'enhance.verify.step.complete', {
    name,
    status,
    durationMs,
    exitCode: step.exitCode,
  });

  return step;
}

// ── Install planning ────────────────────────────────────────────────────────

interface InstallPlan {
  skip: boolean;
  skipReason?: string;
  command: string;
  args: string[];
  manager: 'npm' | 'bun' | 'pnpm' | 'yarn';
}

async function planInstall(
  cwd: string,
  logger: VerifyOpts['logger'],
): Promise<InstallPlan> {
  const hasPkgJson = await fileExists(path.join(cwd, 'package.json'));
  if (!hasPkgJson) {
    logBranch(logger, 'enhance.verify.install-detect-decision', {
      decision: 'skip',
      reason: 'no-package.json',
    });
    return {
      skip: true,
      skipReason: 'no-package.json',
      command: '',
      args: [],
      manager: 'npm',
    };
  }

  // Detect manager via lockfile. bun.lockb wins → pnpm-lock.yaml → yarn.lock → npm.
  const hasBunLock = await fileExists(path.join(cwd, 'bun.lockb'));
  const hasPnpmLock = await fileExists(path.join(cwd, 'pnpm-lock.yaml'));
  const hasYarnLock = await fileExists(path.join(cwd, 'yarn.lock'));

  let manager: InstallPlan['manager'] = 'npm';
  let command = 'npm';
  let args = ['install', '--no-audit', '--no-fund'];

  if (hasBunLock) {
    manager = 'bun';
    command = 'bun';
    args = ['install'];
  } else if (hasPnpmLock) {
    manager = 'pnpm';
    command = 'pnpm';
    args = ['install', '--prefer-frozen-lockfile=false'];
  } else if (hasYarnLock) {
    manager = 'yarn';
    command = 'yarn';
    args = ['install'];
  }

  logBranch(logger, 'enhance.verify.install-detect-decision', {
    decision: manager,
    hasBunLock,
    hasPnpmLock,
    hasYarnLock,
  });

  // Skip-install heuristic: if node_modules/.package-lock.json mtime >=
  // package.json mtime, deps are already in sync. This is fast: a stat()
  // is cheaper than a 30s npm install no-op.
  const skipDecision = await shouldSkipInstall(cwd);
  if (skipDecision.skip) {
    logBranch(logger, 'enhance.verify.install-skip-decision', {
      decision: 'skip',
      reason: skipDecision.reason,
    });
    return {
      skip: true,
      skipReason: skipDecision.reason,
      command,
      args,
      manager,
    };
  }
  logBranch(logger, 'enhance.verify.install-skip-decision', {
    decision: 'run',
    reason: skipDecision.reason,
  });

  return { skip: false, command, args, manager };
}

async function shouldSkipInstall(cwd: string): Promise<{
  skip: boolean;
  reason: string;
}> {
  const nodeModules = path.join(cwd, 'node_modules');
  const nmLockJson = path.join(nodeModules, '.package-lock.json');
  const pkgJson = path.join(cwd, 'package.json');

  try {
    const nmExists = await fileExists(nodeModules);
    if (!nmExists) return { skip: false, reason: 'no-node_modules' };
    const lockExists = await fileExists(nmLockJson);
    if (!lockExists) return { skip: false, reason: 'no-internal-lockfile' };
    const [pkgStat, lockStat] = await Promise.all([
      fs.stat(pkgJson),
      fs.stat(nmLockJson),
    ]);
    if (lockStat.mtimeMs >= pkgStat.mtimeMs) {
      return { skip: true, reason: 'node_modules-fresh' };
    }
    return { skip: false, reason: 'package.json-newer' };
  } catch {
    return { skip: false, reason: 'stat-error' };
  }
}

// ── Script resolvers ────────────────────────────────────────────────────────

interface ResolvedCommand {
  command: string;
  args: string[];
}

async function resolveTestCommand(
  cwd: string,
  override: string | undefined,
  logger: VerifyOpts['logger'],
): Promise<ResolvedCommand | null> {
  if (override) {
    logBranch(logger, 'enhance.verify.test-script-decision', {
      decision: 'override',
      override,
    });
    return splitShellLike(override);
  }
  const scripts = await readPackageScripts(cwd);
  if (!scripts || !scripts.test) {
    logBranch(logger, 'enhance.verify.test-script-decision', {
      decision: 'skip',
      reason: 'no-test-script',
    });
    return null;
  }
  logBranch(logger, 'enhance.verify.test-script-decision', {
    decision: 'use-npm-test',
    scriptValue: scripts.test,
  });
  // Always route through `npm test` for cross-platform consistency.
  return { command: 'npm', args: ['test', '--silent'] };
}

async function resolveBuildCommand(
  cwd: string,
  override: string | undefined,
  logger: VerifyOpts['logger'],
): Promise<ResolvedCommand | null> {
  if (override) {
    logBranch(logger, 'enhance.verify.build-script-decision', {
      decision: 'override',
      override,
    });
    return splitShellLike(override);
  }
  const scripts = await readPackageScripts(cwd);
  if (!scripts || !scripts.build) {
    logBranch(logger, 'enhance.verify.build-script-decision', {
      decision: 'skip',
      reason: 'no-build-script',
    });
    return null;
  }
  logBranch(logger, 'enhance.verify.build-script-decision', {
    decision: 'use-npm-build',
    scriptValue: scripts.build,
  });
  return { command: 'npm', args: ['run', 'build', '--silent'] };
}

async function readPackageScripts(
  cwd: string,
): Promise<Record<string, string> | null> {
  const pkgPath = path.join(cwd, 'package.json');
  try {
    const raw = await fs.readFile(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return null;
  }
}

/**
 * Tiny shell-like splitter for override scripts like 'npm test' or
 * 'pnpm run test'. Does NOT support shell metacharacters; if the override
 * looks suspicious we fall back to invoking via `sh -c` / `cmd /c`.
 */
function splitShellLike(raw: string): ResolvedCommand {
  const trimmed = raw.trim();
  if (/[|&;<>$`\\]/.test(trimmed) || /["']/.test(trimmed)) {
    // Hand off to the shell — verify still works on Windows because we
    // always pass shell:true.
    return {
      command: trimmed,
      args: [],
    };
  }
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0] ?? 'npm';
  return { command: cmd, args: parts.slice(1) };
}

// ── Default spawn runner ────────────────────────────────────────────────────

const defaultSpawnRunner: SpawnRunner = async ({
  command,
  args,
  cwd,
  env,
  timeoutMs,
}) => {
  const isWindows = process.platform === 'win32';

  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // On Windows we must use shell: true so npm/npx/bun/pnpm resolve to
      // their .cmd wrappers. On POSIX, shell: false keeps signals + group
      // kill clean.
      shell: isWindows,
      detached: !isWindows,
      windowsHide: true,
    });
  } catch (err) {
    return {
      exitCode: 127,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      spawnError: err instanceof Error ? err.message : String(err),
    };
  }

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  // Soft per-stream cap to avoid pathological output filling memory; we'll
  // cap to STREAM_CAP_CHARS at the end anyway, but we don't need to keep
  // megabytes in memory.
  const STREAM_BUFFER_CAP = 256 * 1024; // 256 KiB

  child.stdout?.on('data', (chunk: Buffer) => {
    if (stdoutBytes + chunk.length > STREAM_BUFFER_CAP) {
      const remaining = STREAM_BUFFER_CAP - stdoutBytes;
      if (remaining > 0) stdoutChunks.push(chunk.subarray(0, remaining));
      stdoutBytes = STREAM_BUFFER_CAP;
    } else {
      stdoutChunks.push(chunk);
      stdoutBytes += chunk.length;
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderrBytes + chunk.length > STREAM_BUFFER_CAP) {
      const remaining = STREAM_BUFFER_CAP - stderrBytes;
      if (remaining > 0) stderrChunks.push(chunk.subarray(0, remaining));
      stderrBytes = STREAM_BUFFER_CAP;
    } else {
      stderrChunks.push(chunk);
      stderrBytes += chunk.length;
    }
  });

  let spawnErrored = false;
  let spawnErrorMsg = '';
  child.on('error', (err) => {
    spawnErrored = true;
    spawnErrorMsg = err instanceof Error ? err.message : String(err);
  });

  const pid = child.pid ?? -1;
  let timedOut = false;
  let killed = false;
  async function killTree(): Promise<void> {
    if (killed) return;
    killed = true;
    try {
      if (isWindows && pid > 0) {
        await new Promise<void>((resolve) => {
          exec(`taskkill /F /T /PID ${pid}`, () => resolve());
        });
        return;
      }
      try {
        if (pid > 0) process.kill(-pid, 'SIGTERM');
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, SIGTERM_GRACE_MS);
        child.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
      if (child.exitCode === null && child.signalCode === null) {
        try {
          if (pid > 0) process.kill(-pid, 'SIGKILL');
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore — we did our best */
    }
  }

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    void killTree();
  }, timeoutMs);

  const exitInfo: {
    code: number | null;
    signal: NodeJS.Signals | null;
  } = await new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      clearTimeout(timeoutHandle);
      resolve({ code, signal });
    });
  });

  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');

  return {
    exitCode: exitInfo.code,
    signal: exitInfo.signal,
    stdout,
    stderr,
    timedOut,
    spawnError: spawnErrored ? spawnErrorMsg : undefined,
  };
};

// ── Small utilities ─────────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cap a stream to STREAM_CAP_CHARS, keeping the first ~half and last ~half
 * separated by a clear marker. Per dispatch spec: "first 2000 + last 2000".
 */
function capStream(s: string): string {
  if (s.length <= STREAM_CAP_CHARS) return s;
  const half = Math.floor(STREAM_CAP_CHARS / 2);
  const head = s.slice(0, half);
  const tail = s.slice(s.length - half);
  return `${head}\n...[truncated]...\n${tail}`;
}

// ── Exported test helpers ───────────────────────────────────────────────────

/** Exported for tests that want to drive the capping logic directly. */
export const __internals = {
  capStream,
  splitShellLike,
  shouldSkipInstall,
  STREAM_CAP_CHARS,
};
