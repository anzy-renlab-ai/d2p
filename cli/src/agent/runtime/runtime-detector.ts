/**
 * Detects which RuntimeStrategy applies to a project by reading its
 * package.json (Phase 6 §runtime-detector).
 *
 * Decision order:
 *   1. scripts.dev / scripts.start contains `next` → 'next-dev' / 'next-start' (port 3000)
 *   2. scripts.dev contains `vite` → 'vite-dev' (port 5173)
 *   3. scripts.dev / scripts.start contains `node` or `tsx` → 'node-script' (port 3000)
 *   4. Otherwise → null (no Node.js runtime detected; caller skips runtime tests)
 *
 * Emits:
 *   - agent.runtime.detect.start
 *   - agent.runtime.detect.package-json-found / not-found
 *   - agent.runtime.detect.strategy-decision { strategy, reason }
 *   - agent.runtime.detect.complete { runtime }
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TrackLogger } from '../../log-types.js';
import { logBranch, logCatch } from '../../log/branch.js';
import type { DetectedRuntime, RuntimeStrategy } from './types.js';

const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_NEXT_PORT = 3000;
const DEFAULT_VITE_PORT = 5173;
const DEFAULT_NODE_PORT = 3000;

interface PackageJsonShape {
  scripts?: Record<string, string>;
}

export async function detectRuntime(
  cwd: string,
  logger?: TrackLogger | null,
): Promise<DetectedRuntime | null> {
  if (logger) {
    logger.log('info', 'agent.runtime.detect.start', { cwd });
  }

  const pkgPath = path.join(cwd, 'package.json');
  let pkg: PackageJsonShape | null = null;
  try {
    const raw = fs.readFileSync(pkgPath, 'utf8');
    pkg = JSON.parse(raw) as PackageJsonShape;
    logBranch(logger, 'agent.runtime.detect.package-json-found', {
      decision: 'found',
      pkgPath,
      scriptCount: Object.keys(pkg.scripts ?? {}).length,
    });
  } catch (err) {
    logCatch(logger, 'agent.runtime.detect.package-json-not-found', err, {
      pkgPath,
    });
    if (logger) {
      logger.log('info', 'agent.runtime.detect.complete', { runtime: null });
    }
    return null;
  }

  const scripts = pkg.scripts ?? {};
  const dev = (scripts.dev ?? '').trim();
  const start = (scripts.start ?? '').trim();

  const decision = decideStrategy(dev, start);

  if (decision.strategy === 'unknown') {
    logBranch(
      logger,
      'agent.runtime.detect.strategy-decision',
      {
        decision: 'unknown',
        reasoning: decision.reason,
        dev,
        start,
      },
      { level: 'info' },
    );
    if (logger) {
      logger.log('info', 'agent.runtime.detect.complete', { runtime: null });
    }
    return null;
  }

  const runtime: DetectedRuntime = {
    strategy: decision.strategy,
    command: decision.command,
    args: decision.args,
    expectedPort: decision.port,
    readyTimeoutMs: DEFAULT_READY_TIMEOUT_MS,
    envVars: { PORT: String(decision.port), NODE_ENV: 'development' },
  };

  logBranch(
    logger,
    'agent.runtime.detect.strategy-decision',
    {
      decision: decision.strategy,
      reasoning: decision.reason,
      command: decision.command,
      args: decision.args,
      port: decision.port,
    },
    { level: 'info' },
  );

  if (logger) {
    logger.log('info', 'agent.runtime.detect.complete', { runtime });
  }
  return runtime;
}

interface StrategyDecision {
  strategy: RuntimeStrategy;
  command: string;
  args: string[];
  port: number;
  reason: string;
}

function decideStrategy(dev: string, start: string): StrategyDecision {
  // Order matters: Next.js apps often have `start` = `next start`, but if dev
  // is present we prefer it.
  if (containsToken(dev, 'next')) {
    return {
      strategy: 'next-dev',
      command: 'npm',
      args: ['run', 'dev'],
      port: DEFAULT_NEXT_PORT,
      reason: 'scripts.dev contains `next`',
    };
  }
  if (containsToken(start, 'next')) {
    return {
      strategy: 'next-start',
      command: 'npm',
      args: ['run', 'start'],
      port: DEFAULT_NEXT_PORT,
      reason: 'scripts.start contains `next`',
    };
  }
  if (containsToken(dev, 'vite')) {
    return {
      strategy: 'vite-dev',
      command: 'npm',
      args: ['run', 'dev'],
      port: DEFAULT_VITE_PORT,
      reason: 'scripts.dev contains `vite`',
    };
  }
  // node-script can hide behind `node`, `tsx`, or `ts-node`.
  if (
    containsToken(dev, 'node') ||
    containsToken(dev, 'tsx') ||
    containsToken(dev, 'ts-node')
  ) {
    return {
      strategy: 'node-script',
      command: 'npm',
      args: ['run', 'dev'],
      port: detectPort(dev) ?? DEFAULT_NODE_PORT,
      reason: 'scripts.dev contains node/tsx/ts-node',
    };
  }
  if (
    containsToken(start, 'node') ||
    containsToken(start, 'tsx') ||
    containsToken(start, 'ts-node')
  ) {
    return {
      strategy: 'node-script',
      command: 'npm',
      args: ['run', 'start'],
      port: detectPort(start) ?? DEFAULT_NODE_PORT,
      reason: 'scripts.start contains node/tsx/ts-node',
    };
  }
  return {
    strategy: 'unknown',
    command: '',
    args: [],
    port: 0,
    reason: 'no recognised dev/start script',
  };
}

/** Word-boundary check so `next-something` doesn't match `next` falsely. */
function containsToken(s: string, token: string): boolean {
  if (!s) return false;
  return new RegExp('(^|[^a-zA-Z0-9_-])' + escape(token) + '([^a-zA-Z0-9_-]|$)').test(s);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Look for `--port 1234` / `--port=1234` / `PORT=1234` in the script string.
 * Returns the parsed port or null.
 */
function detectPort(script: string): number | null {
  const m1 = /--port[ =](\d{2,5})/.exec(script);
  if (m1) return Number(m1[1]);
  const m2 = /\bPORT=(\d{2,5})\b/.exec(script);
  if (m2) return Number(m2[1]);
  return null;
}
