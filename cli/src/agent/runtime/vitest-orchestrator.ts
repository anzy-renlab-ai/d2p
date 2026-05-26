/**
 * Vitest orchestrator — spawns `npx vitest run --reporter=json` against a
 * user project, captures stdout, parses pass/fail counts + failure details,
 * and optionally enables Istanbul coverage. Phase 8 §vitest-orchestrator
 * (Track 8C).
 *
 * Design notes:
 *   - We use child_process.spawn (not exec) to stream stdout/stderr without
 *     buffering deadlocks for big test runs.
 *   - On Windows, `npx` is `npx.cmd`. We pass `shell: true` so spawn finds
 *     it without a separate Path probe (matches process-launcher.ts).
 *   - vitest writes the JSON reporter output to stdout interleaved with the
 *     default reporter; we use `--reporter=json` last so it gets a chance
 *     to dump after the run completes. We scan stdout for the largest valid
 *     JSON object at the end (vitest emits it in one chunk).
 *   - If JSON parse fails OR vitest binary is missing OR testDir is missing,
 *     we degrade gracefully: return a zero-count VitestRunResult with an
 *     informative `rawStdout` and the non-zero exitCode so callers can tell
 *     the run didn't really happen.
 *   - Timeout: default 120s, max 300s. On timeout we kill the process tree
 *     (taskkill on Windows, group-kill on POSIX) and tag the result.
 *
 * Emits:
 *   - agent.vitest.start { cwd, testDir, withCoverage, timeoutMs }
 *   - agent.vitest.spawn { command, args }
 *   - agent.vitest.stdout-chunk-decision { len } (debug, per chunk)
 *   - agent.vitest.exit { exitCode, durationMs, signal }
 *   - agent.vitest.parse-decision { decision: 'json-found' | 'text-fallback' | 'parse-failure' | 'no-output' }
 *   - agent.vitest.complete { pass, fail, skipped, failuresCount }
 *   - agent.vitest.testdir-missing-decision { testDir }
 *   - agent.vitest.binary-missing-decision { reason }
 *   - agent.vitest.timeout-decision { timeoutMs }
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { exec } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TrackLogger } from '../../log-types.js';
import { logBranch, logCatch } from '../../log/branch.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const SIGTERM_GRACE_MS = 2_000;
const STDOUT_CAP_BYTES = 4 * 1024 * 1024;
const STDERR_CAP_BYTES = 1 * 1024 * 1024;

export interface VitestFailure {
  file: string;
  test: string;
  errorMessage: string;
  stack: string;
}

export interface VitestRunResult {
  exitCode: number;
  testFiles: number;
  pass: number;
  fail: number;
  skipped: number;
  durationMs: number;
  failures: VitestFailure[];
  rawStdout: string;
  /** Discriminator for non-happy paths so callers can render a clear message. */
  status:
    | 'ok'
    | 'tests-failed'
    | 'no-test-dir'
    | 'binary-missing'
    | 'timed-out'
    | 'parse-failure'
    | 'spawn-error';
}

export interface RunVitestOptions {
  cwd: string;
  testDir: string;
  withCoverage?: boolean;
  logger: TrackLogger;
  timeoutMs?: number;
  /** Overridable for tests; defaults to `npx`. */
  npxBin?: string;
}

export async function runVitest(
  opts: RunVitestOptions,
): Promise<VitestRunResult> {
  const {
    cwd,
    testDir,
    withCoverage = false,
    logger,
    timeoutMs: requestedTimeout,
    npxBin = 'npx',
  } = opts;

  const timeoutMs = Math.min(
    Math.max(requestedTimeout ?? DEFAULT_TIMEOUT_MS, 1_000),
    MAX_TIMEOUT_MS,
  );

  logger.log('info', 'agent.vitest.start', {
    cwd,
    testDir,
    withCoverage,
    timeoutMs,
  });

  // Guard 1: testDir must exist (relative to cwd).
  const testDirAbs = path.isAbsolute(testDir) ? testDir : path.join(cwd, testDir);
  const dirOk = await pathExists(testDirAbs);
  if (!dirOk) {
    logBranch(logger, 'agent.vitest.testdir-missing-decision', {
      decision: 'skip',
      testDir,
      testDirAbs,
    });
    return zeroResult({
      status: 'no-test-dir',
      exitCode: 1,
      rawStdout: `[vitest-orchestrator] testDir not found: ${testDirAbs}\n`,
    });
  }

  // Pin --root to the project under test so vitest does NOT walk upward to
  // find a parent vitest.config.* — that would silently swap in someone
  // else's test suite. Pass --dir as well to scope the file scan.
  const args = [
    'vitest',
    'run',
    `--root=${cwd}`,
    `--dir=${testDirAbs}`,
    '--reporter=default',
    '--reporter=json',
  ];
  if (withCoverage) {
    args.push(
      '--coverage',
      '--coverage.reporter=json-summary',
      '--coverage.reportsDirectory=.zerou/coverage',
    );
  }

  logger.log('info', 'agent.vitest.spawn', {
    command: npxBin,
    args,
  });

  const isWindows = process.platform === 'win32';

  let child: ChildProcess;
  try {
    child = spawn(npxBin, args, {
      cwd,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !isWindows,
      shell: isWindows,
      windowsHide: true,
    });
  } catch (err) {
    logCatch(logger, 'agent.vitest.spawn-error', err, { npxBin });
    return zeroResult({
      status: 'spawn-error',
      exitCode: 127,
      rawStdout: `[vitest-orchestrator] spawn failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    });
  }

  const startMs = Date.now();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutTruncated = false;
  let stderrTruncated = false;

  child.stdout?.on('data', (chunk: Buffer) => {
    if (stdoutBytes + chunk.length > STDOUT_CAP_BYTES) {
      if (!stdoutTruncated) {
        const remaining = STDOUT_CAP_BYTES - stdoutBytes;
        if (remaining > 0) stdoutChunks.push(chunk.subarray(0, remaining));
        stdoutBytes = STDOUT_CAP_BYTES;
        stdoutTruncated = true;
      }
    } else {
      stdoutChunks.push(chunk);
      stdoutBytes += chunk.length;
    }
    logBranch(logger, 'agent.vitest.stdout-chunk-decision', {
      decision: 'append',
      len: chunk.length,
      cumulative: stdoutBytes,
      truncated: stdoutTruncated,
    });
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderrBytes + chunk.length > STDERR_CAP_BYTES) {
      if (!stderrTruncated) {
        const remaining = STDERR_CAP_BYTES - stderrBytes;
        if (remaining > 0) stderrChunks.push(chunk.subarray(0, remaining));
        stderrBytes = STDERR_CAP_BYTES;
        stderrTruncated = true;
      }
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
    logCatch(logger, 'agent.vitest.spawn-error', err, { npxBin });
  });

  const pid = child.pid ?? -1;
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
    } catch (err) {
      logCatch(logger, 'agent.vitest.kill-error', err, { pid });
    }
  }

  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    logBranch(logger, 'agent.vitest.timeout-decision', {
      decision: 'kill',
      timeoutMs,
    });
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

  const durationMs = Date.now() - startMs;
  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  const rawStdout =
    stdout +
    (stderr ? `\n--- stderr ---\n${stderr}` : '') +
    (stdoutTruncated ? '\n[stdout truncated]\n' : '') +
    (stderrTruncated ? '\n[stderr truncated]\n' : '');

  logger.log('info', 'agent.vitest.exit', {
    exitCode: exitInfo.code,
    signal: exitInfo.signal,
    durationMs,
    timedOut,
    spawnErrored,
  });

  // Spawn failure → binary missing or PATH issue.
  if (spawnErrored) {
    return {
      ...zeroResult({
        status: 'binary-missing',
        exitCode: exitInfo.code ?? 127,
        rawStdout: rawStdout + `\n[spawn-error] ${spawnErrorMsg}\n`,
      }),
      durationMs,
    };
  }

  if (timedOut) {
    return {
      ...zeroResult({
        status: 'timed-out',
        exitCode: exitInfo.code ?? 124,
        rawStdout,
      }),
      durationMs,
    };
  }

  // Heuristic: vitest exits with 1 when tests fail AND when binary missing
  // (npx falls through). Distinguish by stderr signature.
  if (looksLikeBinaryMissing(stderr, stdout, exitInfo.code)) {
    logBranch(logger, 'agent.vitest.binary-missing-decision', {
      decision: 'missing',
      reason: 'stderr-pattern',
    });
    return {
      ...zeroResult({
        status: 'binary-missing',
        exitCode: exitInfo.code ?? 127,
        rawStdout,
      }),
      durationMs,
    };
  }

  // Parse vitest --reporter=json output from stdout.
  const parsed = parseVitestJson(stdout);
  if (parsed) {
    logBranch(logger, 'agent.vitest.parse-decision', {
      decision: 'json-found',
      pass: parsed.pass,
      fail: parsed.fail,
      skipped: parsed.skipped,
    });
    logger.log('info', 'agent.vitest.complete', {
      pass: parsed.pass,
      fail: parsed.fail,
      skipped: parsed.skipped,
      failuresCount: parsed.failures.length,
    });
    return {
      exitCode: exitInfo.code ?? 0,
      testFiles: parsed.testFiles,
      pass: parsed.pass,
      fail: parsed.fail,
      skipped: parsed.skipped,
      durationMs,
      failures: parsed.failures,
      rawStdout,
      status: parsed.fail > 0 ? 'tests-failed' : 'ok',
    };
  }

  // Fallback: scrape default-reporter text output.
  const text = parseDefaultReporterText(stdout);
  if (text) {
    logBranch(logger, 'agent.vitest.parse-decision', {
      decision: 'text-fallback',
      pass: text.pass,
      fail: text.fail,
      skipped: text.skipped,
    });
    logger.log('info', 'agent.vitest.complete', {
      pass: text.pass,
      fail: text.fail,
      skipped: text.skipped,
      failuresCount: 0,
    });
    return {
      exitCode: exitInfo.code ?? 0,
      testFiles: 0,
      pass: text.pass,
      fail: text.fail,
      skipped: text.skipped,
      durationMs,
      failures: [],
      rawStdout,
      status: text.fail > 0 ? 'tests-failed' : 'ok',
    };
  }

  // No usable output at all.
  if (!stdout.trim() && !stderr.trim()) {
    logBranch(logger, 'agent.vitest.parse-decision', {
      decision: 'no-output',
    });
  } else {
    logBranch(logger, 'agent.vitest.parse-decision', {
      decision: 'parse-failure',
    });
  }
  return {
    ...zeroResult({
      status: 'parse-failure',
      exitCode: exitInfo.code ?? 1,
      rawStdout,
    }),
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

interface ParsedJsonReport {
  testFiles: number;
  pass: number;
  fail: number;
  skipped: number;
  failures: VitestFailure[];
}

/**
 * Vitest --reporter=json emits a single JSON object at the end of stdout
 * (interleaved with default reporter when both are active). The object
 * structure mirrors Jest's: `{ numTotalTests, numPassedTests, ..., testResults: [...] }`.
 *
 * We scan from the end for the last `\n{` boundary and try JSON.parse on
 * progressively wider slices until one parses. Robust to ANSI prefixes and
 * the default reporter's trailing summary.
 */
function parseVitestJson(stdout: string): ParsedJsonReport | null {
  if (!stdout) return null;
  // Strip ANSI escape codes (the default reporter sometimes emits them
  // even with FORCE_COLOR=0 on some terminals).
  const clean = stdout.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');

  // Find candidate JSON: rightmost `{` that starts a balanced object.
  // Strategy: walk from right to left, track brace balance.
  const candidates: number[] = [];
  for (let i = clean.length - 1; i >= 0; i--) {
    if (clean[i] === '{') candidates.push(i);
  }

  for (const start of candidates) {
    const slice = clean.slice(start);
    const endIdx = findBalancedEnd(slice);
    if (endIdx < 0) continue;
    const candidate = slice.slice(0, endIdx + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (
        parsed &&
        typeof parsed === 'object' &&
        ('testResults' in parsed ||
          'numTotalTests' in parsed ||
          'numPassedTests' in parsed)
      ) {
        return normalizeJsonReport(parsed);
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

function findBalancedEnd(s: string): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function normalizeJsonReport(parsed: unknown): ParsedJsonReport {
  const obj = parsed as Record<string, unknown>;
  const testResults = Array.isArray(obj.testResults)
    ? (obj.testResults as Array<Record<string, unknown>>)
    : [];

  let pass = 0;
  let fail = 0;
  let skipped = 0;
  const failures: VitestFailure[] = [];

  for (const tr of testResults) {
    // Vitest's --reporter=json emits `name` as the test file path; older
    // versions used `testFilePath`. Accept both for resilience.
    const file =
      typeof tr.name === 'string'
        ? tr.name
        : typeof tr.testFilePath === 'string'
          ? tr.testFilePath
          : 'unknown';
    const inner = Array.isArray(tr.testResults)
      ? (tr.testResults as Array<Record<string, unknown>>)
      : Array.isArray(tr.assertionResults)
        ? (tr.assertionResults as Array<Record<string, unknown>>)
        : [];

    for (const t of inner) {
      const status = typeof t.status === 'string' ? t.status : '';
      const title =
        typeof t.fullName === 'string'
          ? t.fullName
          : typeof t.title === 'string'
            ? t.title
            : 'unknown-test';
      if (status === 'passed') pass++;
      else if (status === 'skipped' || status === 'pending' || status === 'todo')
        skipped++;
      else if (status === 'failed') {
        fail++;
        const msgs = Array.isArray(t.failureMessages)
          ? (t.failureMessages as string[])
          : [];
        const joined = msgs.join('\n');
        const { errorMessage, stack } = splitErrorAndStack(joined);
        failures.push({
          file,
          test: title,
          errorMessage,
          stack,
        });
      }
    }
  }

  // Some vitest versions populate top-level counts directly.
  if (pass === 0 && fail === 0 && skipped === 0) {
    pass = toNum(obj.numPassedTests) ?? 0;
    fail = toNum(obj.numFailedTests) ?? 0;
    skipped =
      (toNum(obj.numPendingTests) ?? 0) + (toNum(obj.numTodoTests) ?? 0);
  }

  return {
    testFiles: testResults.length,
    pass,
    fail,
    skipped,
    failures,
  };
}

function splitErrorAndStack(joined: string): {
  errorMessage: string;
  stack: string;
} {
  if (!joined) return { errorMessage: '', stack: '' };
  const lines = joined.split(/\r?\n/);
  // First non-empty line that doesn't start with whitespace is the message;
  // the rest is the stack. Be conservative: cap each to 2KB.
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstIdx < 0) return { errorMessage: '', stack: joined.slice(0, 2048) };
  const firstLine = lines[firstIdx] ?? '';
  const msg = firstLine.slice(0, 2048);
  const rest = lines.slice(firstIdx + 1).join('\n').slice(0, 2048);
  return { errorMessage: msg, stack: rest };
}

/**
 * Fallback: grep the default-reporter summary line.
 *   "Test Files  1 failed | 1 passed (2)"
 *   "Tests  1 failed | 3 passed (4)"
 */
function parseDefaultReporterText(stdout: string): {
  pass: number;
  fail: number;
  skipped: number;
} | null {
  if (!stdout) return null;
  // Strip ANSI for grep.
  const clean = stdout.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
  // Match the "Tests" summary line (not "Test Files" — that counts files).
  const testsLine = clean
    .split(/\r?\n/)
    .reverse()
    .find((l) => /^\s*Tests\s/.test(l));
  if (!testsLine) return null;

  const passMatch = /(\d+)\s+passed/.exec(testsLine);
  const failMatch = /(\d+)\s+failed/.exec(testsLine);
  const skipMatch = /(\d+)\s+(?:skipped|todo)/.exec(testsLine);
  if (!passMatch && !failMatch) return null;
  return {
    pass: passMatch ? Number(passMatch[1]) : 0,
    fail: failMatch ? Number(failMatch[1]) : 0,
    skipped: skipMatch ? Number(skipMatch[1]) : 0,
  };
}

function looksLikeBinaryMissing(
  stderr: string,
  stdout: string,
  exitCode: number | null,
): boolean {
  if (exitCode === 0) return false;
  const lower = stderr.toLowerCase();
  // Known cross-platform signatures.
  if (
    lower.includes('could not determine executable') ||
    lower.includes('vitest: not found') ||
    lower.includes('command not found') ||
    lower.includes('is not recognized as an internal or external command') ||
    lower.includes('npm error 404') ||
    lower.includes('no such file or directory') ||
    lower.includes('enoent')
  ) {
    return true;
  }
  // Windows cmd may emit localised "not recognised" messages in non-English
  // locales (e.g. GBK on zh-CN). If stdout is empty AND stderr is non-empty
  // AND we never saw any vitest output marker, treat as binary-missing.
  const stdoutClean = stdout.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
  if (
    stderr.length > 0 &&
    stdoutClean.length === 0 &&
    !/vitest/i.test(stdoutClean) &&
    !/vitest/i.test(stderr)
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function zeroResult(opts: {
  status: VitestRunResult['status'];
  exitCode: number;
  rawStdout: string;
}): VitestRunResult {
  return {
    exitCode: opts.exitCode,
    testFiles: 0,
    pass: 0,
    fail: 0,
    skipped: 0,
    durationMs: 0,
    failures: [],
    rawStdout: opts.rawStdout,
    status: opts.status,
  };
}
