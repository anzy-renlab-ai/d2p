/**
 * Launches a demo process, polls until its port is listening, returns a
 * RuntimeProcess handle (Phase 6 §process-launcher).
 *
 * Lifecycle:
 *   1. spawn child (npm/node/...) detached=false, stdio='pipe'
 *   2. capture stdout/stderr (debug logs, truncated 200 chars per line)
 *   3. poll port via net.connect(localhost, port) every 500ms up to readyTimeoutMs
 *   4. on ready → resolve RuntimeProcess
 *   5. on child exit before ready → reject with crash message
 *   6. on timeout → kill child + reject
 *
 * Windows tree-kill: Node's `process.kill(pid)` only kills the immediate
 * child, leaving npm-spawned shells / node processes behind. We use
 * `taskkill /F /T /PID <pid>` on Windows and `process.kill(-pid)` (group)
 * on POSIX. Falls back to `child.kill()` if both fail.
 *
 * Emits:
 *   - agent.runtime.launch.start { command, args }
 *   - agent.runtime.launch.stdout / stderr (debug, truncated)
 *   - agent.runtime.launch.port-poll { port, attempt }
 *   - agent.runtime.launch.ready { port, durationMs }
 *   - agent.runtime.launch.timeout
 *   - agent.runtime.launch.crash { code, signal }
 *   - agent.runtime.launch.kill { method, durationMs }
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { exec } from 'node:child_process';
import * as net from 'node:net';
import type { TrackLogger } from '../../log-types.js';
import { logBranch, logCatch } from '../../log/branch.js';
import type { DetectedRuntime, RuntimeProcess } from './types.js';

const POLL_INTERVAL_MS = 500;
const LINE_LOG_TRUNCATE = 200;
const SIGTERM_GRACE_MS = 2000;

/** Optional override for the listen port. When set, we use this instead of
 * detected.expectedPort AND set `PORT=<n>` in the child env so fixtures honor
 * it. Used by tests to avoid port 3000 collisions with the user's dev server. */
export interface LaunchOptionsExtras {
  portOverride?: number;
}

export interface LaunchOptions {
  cwd: string;
  logger?: TrackLogger | null;
  /** Override readyTimeoutMs (otherwise uses detected.readyTimeoutMs). */
  readyTimeoutMs?: number;
  /** Override listen port. Sets PORT env on child + polls this port. */
  portOverride?: number;
  /** Override polling cadence — used by tests. */
  pollIntervalMs?: number;
}

export async function launchRuntime(
  detected: DetectedRuntime,
  opts: LaunchOptions,
): Promise<RuntimeProcess> {
  const { cwd, logger } = opts;
  const readyTimeout = opts.readyTimeoutMs ?? detected.readyTimeoutMs;
  const pollInterval = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  const port = opts.portOverride ?? detected.expectedPort;

  if (logger) {
    logger.log('info', 'agent.runtime.launch.start', {
      command: detected.command,
      args: detected.args,
      cwd,
      expectedPort: port,
      readyTimeoutMs: readyTimeout,
    });
  }

  // On Windows, npm is `npm.cmd` and `spawn` won't find it without shell:true
  // for `.cmd` files. We pass shell:true on Windows for command resolution
  // and use detached:true on POSIX so we can group-kill children.
  const isWindows = process.platform === 'win32';
  const child: ChildProcess = spawn(detected.command, detected.args, {
    cwd,
    env: {
      ...process.env,
      ...detected.envVars,
      ...(opts.portOverride !== undefined ? { PORT: String(opts.portOverride) } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !isWindows,
    shell: isWindows,
    windowsHide: true,
  });

  const launchStart = Date.now();
  let crashed = false;
  let crashInfo: { code: number | null; signal: NodeJS.Signals | null } = {
    code: null,
    signal: null,
  };
  let resolved = false;

  // Stream stdout/stderr (truncated) to debug log.
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (logger) {
        logger.log('debug', 'agent.runtime.launch.stdout', {
          line: line.slice(0, LINE_LOG_TRUNCATE),
        });
      }
    }
  });
  child.stderr?.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (logger) {
        logger.log('debug', 'agent.runtime.launch.stderr', {
          line: line.slice(0, LINE_LOG_TRUNCATE),
        });
      }
    }
  });

  child.on('exit', (code, signal) => {
    crashInfo = { code, signal };
    if (!resolved) {
      crashed = true;
      if (logger) {
        logger.log('warn', 'agent.runtime.launch.crash', {
          code,
          signal,
          stage: 'before-ready',
        });
      }
    }
  });
  child.on('error', (err) => {
    logCatch(logger, 'agent.runtime.launch.spawn-error', err, {
      command: detected.command,
    });
    crashed = true;
    crashInfo = { code: -1, signal: null };
  });

  // Build kill closure once; safe to call multiple times.
  const pid = child.pid ?? -1;
  let killed = false;
  async function killProcess(): Promise<void> {
    if (killed) return;
    killed = true;
    const killStart = Date.now();
    try {
      if (isWindows && pid > 0) {
        await new Promise<void>((resolve) => {
          exec(`taskkill /F /T /PID ${pid}`, (err) => {
            if (err) {
              logCatch(logger, 'agent.runtime.launch.kill', err, {
                method: 'taskkill',
                pid,
              });
              try {
                child.kill();
              } catch {
                /* ignore */
              }
            }
            resolve();
          });
        });
        if (logger) {
          logger.log('info', 'agent.runtime.launch.kill', {
            method: 'taskkill',
            pid,
            durationMs: Date.now() - killStart,
          });
        }
        return;
      }
      // POSIX: try group-kill (negative pid). Spawn was detached so the child
      // is the leader of its own process group.
      try {
        if (pid > 0) process.kill(-pid, 'SIGTERM');
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }
      // Wait up to grace, then SIGKILL.
      const exited = await waitForExit(child, SIGTERM_GRACE_MS);
      if (!exited) {
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
      if (logger) {
        logger.log('info', 'agent.runtime.launch.kill', {
          method: exited ? 'sigterm' : 'sigkill',
          pid,
          durationMs: Date.now() - killStart,
        });
      }
    } catch (err) {
      logCatch(logger, 'agent.runtime.launch.kill', err, { pid });
    }
  }

  // Poll port; resolve on ready, reject on crash, reject on timeout.
  try {
    const ok = await pollPortUntilReady({
      port,
      pollIntervalMs: pollInterval,
      timeoutMs: readyTimeout,
      logger,
      // Also check child.exitCode — on Windows, npm.cmd → cmd.exe → node
      // chains can delay the 'exit' event by several hundred ms, but
      // exitCode is set synchronously by Node once the process is gone.
      isCrashed: () => crashed || child.exitCode !== null,
    });
    if (!ok) {
      if (crashed) {
        await killProcess(); // best-effort
        throw new Error(
          `runtime crashed before ready (code=${crashInfo.code} signal=${crashInfo.signal})`,
        );
      }
      // timeout
      if (logger) {
        logger.log('warn', 'agent.runtime.launch.timeout', {
          port,
          readyTimeoutMs: readyTimeout,
        });
      }
      await killProcess();
      throw new Error(`runtime did not open port ${port} within ${readyTimeout}ms`);
    }

    resolved = true;
    const durationMs = Date.now() - launchStart;
    if (logger) {
      logger.log('info', 'agent.runtime.launch.ready', {
        port,
        pid,
        durationMs,
      });
    }

    return {
      pid,
      port,
      baseUrl: `http://localhost:${port}`,
      startTime: Date.now(),
      kill: killProcess,
    };
  } catch (err) {
    // Ensure no zombie left behind on any error path.
    await killProcess();
    throw err;
  }
}

interface PollOpts {
  port: number;
  pollIntervalMs: number;
  timeoutMs: number;
  logger?: TrackLogger | null;
  isCrashed: () => boolean;
}

/**
 * Poll the port until it accepts a TCP connection or timeout / crash is hit.
 * Returns true on ready, false on crash-or-timeout.
 */
async function pollPortUntilReady(opts: PollOpts): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    if (opts.isCrashed()) return false;
    attempt++;
    const open = await tryConnect(opts.port);
    if (opts.logger) {
      logBranch(opts.logger, 'agent.runtime.launch.port-poll', {
        decision: open ? 'ready' : 'not-ready',
        port: opts.port,
        attempt,
      });
    }
    if (open) {
      // Race guard: if a different process is squatting on this port
      // (e.g. user has Next.js dev server on 3000), tryConnect can succeed
      // while OUR child is in the process of crashing. Poll isCrashed for
      // up to 500ms after a successful connect — slow exit propagation
      // on Windows (npm.cmd → cmd.exe → node) can take a few hundred ms.
      for (let i = 0; i < 10; i++) {
        await sleep(50);
        if (opts.isCrashed()) return false;
      }
      return true;
    }
    await sleep(opts.pollIntervalMs);
  }
  return false;
}

function tryConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port }, () => {
      sock.end();
      resolve(true);
    });
    sock.on('error', () => {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(false);
    });
    // Connect attempt itself shouldn't take more than 1s.
    sock.setTimeout(1000, () => {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(false);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    let done = false;
    const onExit = () => {
      if (done) return;
      done = true;
      resolve(true);
    };
    child.once('exit', onExit);
    setTimeout(() => {
      if (done) return;
      done = true;
      child.off('exit', onExit);
      resolve(false);
    }, ms);
  });
}
