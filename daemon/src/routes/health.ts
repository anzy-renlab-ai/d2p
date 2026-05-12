import { Hono } from 'hono';
import type { HealthResponse } from '../types.js';
import { defaultDbPath } from '../storage/db.js';
import { claudeVersion } from '../subproc/claude.js';
import { gitVersion } from '../subproc/git.js';
import { PROMPTS_VERSION } from '../prompts/version.js';

const startedAt = Date.now();
const DAEMON_VERSION = '0.1.0';

export const healthRoutes = new Hono();

healthRoutes.get('/health', async (c) => {
  const [cv, gv] = await Promise.all([claudeVersion(), gitVersion()]);
  const body: HealthResponse = {
    ok: cv !== null && gv !== null,
    daemonVersion: DAEMON_VERSION,
    promptsVersion: PROMPTS_VERSION,
    claudeCli: { found: cv !== null, version: cv },
    gitCli: { found: gv !== null, version: gv },
    dbPath: defaultDbPath(),
    uptimeMs: Date.now() - startedAt,
  };
  return c.json(body);
});

healthRoutes.get('/doctor', async (c) => {
  const checks: { name: string; ok: boolean; detail?: string }[] = [];

  const cv = await claudeVersion();
  checks.push({
    name: 'claude-cli-reachable',
    ok: cv !== null,
    detail: cv ?? 'claude binary not found on PATH (set D2P_CLAUDE_BIN)',
  });

  const gv = await gitVersion();
  checks.push({
    name: 'git',
    ok: gv !== null,
    detail: gv ?? 'git not found on PATH',
  });

  const ok = checks.every((c) => c.ok);
  return c.json({ ok, checks });
});
