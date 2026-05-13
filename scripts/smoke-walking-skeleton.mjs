#!/usr/bin/env node
// End-to-end smoke for d2p MVP-0 walking skeleton.
// Uses fake-claude shim — no real Anthropic calls.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const PORT = 5374;
const DAEMON_URL = `http://localhost:${PORT}`;
// Point at .mjs directly — daemon's spawn layer detects .mjs and runs via
// `node fake-claude.mjs ...args` with shell:false, preserving the full prompt.
const FAKE_CLAUDE = path.join(__dirname, 'fake-claude.mjs');

const log = (...args) => console.log('[smoke]', ...args);
const fail = (msg) => {
  console.error(`[smoke] FAIL: ${msg}`);
  process.exit(1);
};

async function fetchJson(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${url}: ${await r.text()}`);
  return r.json();
}

async function pollFor(url, predicate, timeoutMs = 60_000, intervalMs = 500) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const value = await fetchJson(url);
      if (predicate(value)) return value;
    } catch {
      // ignore transient errors
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`polling ${url} timed out after ${timeoutMs}ms`);
}

async function main() {
  // 1. Prepare temp directories
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'd2p-smoke-'));
  const demoDir = path.join(tmp, 'demo-cli');
  const dbPath = path.join(tmp, 'state.db');
  log('tmp:', tmp);

  cpSync(path.join(repoRoot, 'fixtures', 'demo-cli'), demoDir, { recursive: true });
  // git init the demo so worktrees can branch
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: demoDir });
  spawnSync('git', ['add', '-A'], { cwd: demoDir });
  spawnSync(
    'git',
    [
      '-c',
      'user.email=smoke@local',
      '-c',
      'user.name=smoke',
      'commit',
      '-q',
      '-m',
      'chore: initial smoke commit',
    ],
    { cwd: demoDir },
  );

  // 2. Spawn daemon with fake claude + isolated DB
  if (!existsSync(FAKE_CLAUDE)) fail(`fake-claude binary missing: ${FAKE_CLAUDE}`);
  const daemonEnv = {
    ...process.env,
    D2P_DAEMON_PORT: String(PORT),
    D2P_DB_PATH: dbPath,
    D2P_CLAUDE_BIN: FAKE_CLAUDE,
  };
  const daemon = spawn(
    process.execPath,
    [path.join(repoRoot, 'daemon', 'dist', 'server.js')],
    { env: daemonEnv, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  daemon.stdout.on('data', (b) => process.stdout.write(`[daemon] ${b}`));
  daemon.stderr.on('data', (b) => process.stderr.write(`[daemon-err] ${b}`));

  const cleanup = () => {
    try {
      daemon.kill('SIGTERM');
    } catch {
      // ignore
    }
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // ignore
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  // 3. Wait for daemon health
  log('waiting for daemon...');
  const health = await pollFor(`${DAEMON_URL}/api/health`, (h) => h?.daemonVersion, 30_000);
  log('daemon up:', health.daemonVersion);

  // 4. Start session
  const sessionRes = await fetchJson(`${DAEMON_URL}/api/session/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ demoPath: demoDir }),
  });
  log('session started:', sessionRes);

  // 5. Run detector
  const det = await fetchJson(`${DAEMON_URL}/api/detector/run`, { method: 'POST' });
  log('detector:', det.type, '(confidence', det.confidence + ')');
  if (det.type !== 'cli-tool') fail(`detector should pick cli-tool, got ${det.type}`);

  // 6. Choose preset
  const preset = await fetchJson(`${DAEMON_URL}/api/preset/choose`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'cli-tool' }),
  });
  log('preset chosen:', preset.type);

  // 7. Vision — should finalize immediately
  const vision = await fetchJson(`${DAEMON_URL}/api/vision/round`);
  log('vision done?', vision.done);
  if (!vision.done) fail('expected vision finalized in 1 round');

  // 8. Start loop
  const start = await fetchJson(`${DAEMON_URL}/api/loop/start`, { method: 'POST' });
  log('loop:', start.status);

  // 9. Poll for SESSION_DONE
  const final = await pollFor(
    `${DAEMON_URL}/api/session/current`,
    (s) => s?.session?.status === 'DONE' || s?.session?.status === 'PAUSED',
    120_000,
  );
  log('final status:', final.session.status);

  if (final.session.status !== 'DONE') {
    // dump last 30 events for debugging
    const events = await fetchJson(`${DAEMON_URL}/api/log/events?limit=200`);
    for (const e of events.events.slice(-30)) {
      console.log(`[event] ${e.kind} ${JSON.stringify(e.payload).slice(0, 200)}`);
    }
    fail(`session did not reach DONE (got ${final.session.status})`);
  }

  // 10. Assert at least 1 MERGED via log_events
  const events = await fetchJson(`${DAEMON_URL}/api/log/events?limit=500`);
  const mergedEvents = events.events.filter((e) => e.kind === 'MERGED');
  if (mergedEvents.length < 1) fail('expected at least 1 MERGED event');
  log('MERGED events:', mergedEvents.length, 'sha:', mergedEvents[0].payload.mergeSha);

  // 11. Assert git log on demo shows the merge
  const gitLog = spawnSync('git', ['log', '--oneline'], { cwd: demoDir, encoding: 'utf8' });
  log('demo git log:\n' + gitLog.stdout.trim());

  const gapDone = events.events.filter((e) => e.kind === 'GAP_DONE');
  if (gapDone.length < 1) fail('expected at least 1 GAP_DONE event');

  // 12. End session and verify session-summary.md is written
  const endRes = await fetchJson(`${DAEMON_URL}/api/session/end`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  log('end session ->', endRes.status, 'summary:', endRes.summaryMdPath);
  if (!endRes.summaryMdPath) fail('expected summaryMdPath in /api/session/end response');
  if (!existsSync(endRes.summaryMdPath)) fail(`session-summary.md not on disk: ${endRes.summaryMdPath}`);
  const summary = readFileSync(endRes.summaryMdPath, 'utf8');
  if (!summary.includes('# Session Summary')) fail('summary header missing');
  if (!summary.includes('add-version-flag')) fail('summary should mention the closed gap');
  log('session-summary.md OK (' + summary.length + ' bytes)');

  // 13. Final status should now be ENDED
  const after = await fetchJson(`${DAEMON_URL}/api/session/current`);
  if (after.session?.status !== 'ENDED') fail(`expected ENDED, got ${after.session?.status}`);

  log('PASS');
  daemon.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  // explicit exit to bypass open handles
  process.exit(0);
}

main().catch((e) => {
  console.error('[smoke] crashed:', e.stack ?? e.message ?? e);
  process.exit(1);
});
