// Shared harness for Playwright e2e: spins up a fresh daemon (claude-cli +
// fake-claude shim) AND a Vite dev server, returns the URLs. Each test gets
// an isolated tempdir / DB / config / random ports.

import { spawn, type ChildProcess, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

export interface Harness {
  daemonUrl: string;
  uiUrl: string;
  tmpDir: string;
  daemonPort: number;
  uiPort: number;
  teardown: () => Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (!addr || typeof addr !== 'object') return reject(new Error('no port'));
      const p = addr.port;
      srv.close(() => resolve(p));
    });
  });
}

async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`waitForHttp(${url}) timed out`);
}

export async function startHarness(): Promise<Harness> {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'd2p-e2e-'));
  const dbPath = path.join(tmpDir, 'state.db');
  const configPath = path.join(tmpDir, 'config.json');

  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ engine: { kind: 'claude-cli' } }, null, 2));

  // Make a demo dir the UI can target.
  const demoDir = path.join(tmpDir, 'demo-cli');
  spawnSync('git', ['init', '-q', '-b', 'main', demoDir]);
  writeFileSync(path.join(demoDir, 'README.md'), '# tiny demo\n');
  spawnSync('git', ['add', '-A'], { cwd: demoDir });
  spawnSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'],
    { cwd: demoDir },
  );

  const daemonPort = await freePort();
  const uiPort = await freePort();

  const daemon: ChildProcess = spawn(
    process.execPath,
    [path.join(repoRoot, 'daemon', 'dist', 'server.js')],
    {
      env: {
        ...process.env,
        D2P_DAEMON_PORT: String(daemonPort),
        D2P_DB_PATH: dbPath,
        D2P_CONFIG_PATH: configPath,
        D2P_CLAUDE_BIN: path.join(repoRoot, 'scripts', 'fake-claude.mjs'),
        D2P_UI_ORIGIN: `http://localhost:${uiPort}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  daemon.stderr?.on('data', (b) => process.stderr.write(`[daemon] ${b}`));

  await waitForHttp(`http://localhost:${daemonPort}/api/health`);

  const isWin = process.platform === 'win32';
  const vite: ChildProcess = spawn(
    isWin ? 'npm.cmd' : 'npm',
    ['exec', 'vite', '--', '--port', String(uiPort), '--strictPort'],
    {
      cwd: path.join(repoRoot, 'ui'),
      env: {
        ...process.env,
        D2P_DAEMON_PORT: String(daemonPort),
        D2P_UI_PORT: String(uiPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWin,
    },
  );
  vite.stderr?.on('data', (b) => process.stderr.write(`[vite] ${b}`));

  await waitForHttp(`http://localhost:${uiPort}/`);

  return {
    daemonUrl: `http://localhost:${daemonPort}`,
    uiUrl: `http://localhost:${uiPort}`,
    tmpDir,
    daemonPort,
    uiPort,
    teardown: async () => {
      try { daemon.kill('SIGTERM'); } catch { /* ignore */ }
      try { vite.kill('SIGTERM'); } catch { /* ignore */ }
      // give them a beat to exit before nuking tmp
      await new Promise((r) => setTimeout(r, 500));
      try { rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ }
    },
  };
}

export { repoRoot };
