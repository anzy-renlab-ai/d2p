import { Hono } from 'hono';
import path from 'node:path';
import os from 'node:os';
import { access, constants, mkdir, writeFile, rm } from 'node:fs/promises';
import type { HealthResponse } from '../types.js';
import { defaultDbPath } from '../storage/db.js';
import { claudeVersion } from '../subproc/claude.js';
import { gitVersion } from '../subproc/git.js';
import { PROMPTS_VERSION } from '../prompts/version.js';
import { listAvailablePresets } from '../preset/loader.js';
import { currentCriticPolicy, currentEngineConfig, currentCriticConfig } from '../engines/registry.js';
import { engineFamily, engineFamilyLabel } from '../engines/router.js';

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

  // DB writable
  try {
    const dbDir = path.dirname(defaultDbPath());
    await mkdir(dbDir, { recursive: true });
    await access(dbDir, constants.W_OK);
    checks.push({ name: 'db-dir-writable', ok: true, detail: dbDir });
  } catch (e) {
    checks.push({ name: 'db-dir-writable', ok: false, detail: (e as Error).message });
  }

  // Tempdir writable (proxy for "worktree parent writable" — actual parent
  // depends on demo path which is per-session)
  try {
    const probe = path.join(os.tmpdir(), `.d2p-probe-${Date.now()}.tmp`);
    await writeFile(probe, 'ok');
    await rm(probe, { force: true });
    checks.push({ name: 'tempdir-writable', ok: true, detail: os.tmpdir() });
  } catch (e) {
    checks.push({ name: 'tempdir-writable', ok: false, detail: (e as Error).message });
  }

  // Preset library present
  try {
    const types = await listAvailablePresets();
    checks.push({
      name: 'presets-loaded',
      ok: types.length > 0,
      detail: types.length ? `${types.length} presets: ${types.join(', ')}` : 'no presets found',
    });
  } catch (e) {
    checks.push({ name: 'presets-loaded', ok: false, detail: (e as Error).message });
  }

  // F1 — cross-engine critic policy. Surface here so the UI can paint the
  // cross-family badge without needing a separate endpoint.
  const policy = currentCriticPolicy();
  const workerCfg = currentEngineConfig();
  const criticCfg = currentCriticConfig();
  const enginePolicy = policy && workerCfg
    ? {
        worker: { kind: workerCfg.kind, family: engineFamilyLabel(engineFamily(workerCfg)) },
        critic: criticCfg
          ? { kind: criticCfg.kind, family: engineFamilyLabel(engineFamily(criticCfg)) }
          : null,
        crossFamily: policy.crossFamily,
        reason: policy.reason,
      }
    : null;

  // Per v0.7 §3.1 MVP-0.5 strict cross-engine policy: degraded mode (single
  // engine family) makes the daemon refuse to start sessions. Surface this
  // as a doctor check so `d2p doctor` exit code = 1 when degraded, prompting
  // user to install / configure a second engine.
  if (enginePolicy) {
    if (enginePolicy.crossFamily) {
      checks.push({
        name: 'cross-engine-reviewer-active',
        ok: true,
        detail: `worker=${enginePolicy.worker.family} critic=${enginePolicy.critic?.family ?? 'n/a'}`,
      });
    } else {
      const hint =
        enginePolicy.reason === 'no-critic-configured'
          ? 'set criticEngine in ~/.d2p/config.json to a different LLM family'
          : 'choose a critic engine of a different family from the worker';
      checks.push({
        name: 'cross-engine-reviewer-active',
        ok: false,
        detail: `degraded (${enginePolicy.reason}): ${hint}. Session start will be refused with E_CROSS_ENGINE_REQUIRED. Override for tests with D2P_ALLOW_DEGRADED_REVIEWER=1.`,
      });
    }
  }

  const ok = checks.every((c) => c.ok);
  return c.json({ ok, checks, enginePolicy });
});
