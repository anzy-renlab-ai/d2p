import { mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const D2P_HOME = path.join(os.homedir(), '.d2p');
const PID_FILE = path.join(D2P_HOME, 'daemon.pid');
const LOG_FILE = path.join(D2P_HOME, 'daemon.log');

const DAEMON_URL = `http://localhost:${process.env.D2P_DAEMON_PORT ?? 5174}`;
const UI_URL = `http://localhost:${process.env.D2P_UI_PORT ?? 5173}`;

export function ensureHome(): void {
  mkdirSync(D2P_HOME, { recursive: true });
}

export function readPid(): number | null {
  try {
    const raw = readFileSync(PID_FILE, 'utf8').trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writePid(pid: number): void {
  ensureHome();
  writeFileSync(PID_FILE, String(pid));
}

export function clearPid(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function daemonReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${DAEMON_URL}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function pollUntilReachable(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await daemonReachable()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function repoRoot(): string {
  // dist/daemon-control.js -> repo root is three levels up.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

export function spawnDaemon(devMode: boolean): number {
  ensureHome();
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = devMode ? ['run', 'dev', '-w', 'daemon'] : ['run', 'start', '-w', 'daemon'];
  const fd = openSync(LOG_FILE, 'a');
  const child = spawn(cmd, args, {
    cwd: repoRoot(),
    detached: true,
    stdio: ['ignore', fd, fd],
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  child.unref();
  writePid(child.pid ?? -1);
  return child.pid ?? -1;
}

export function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '""', url], {
      detached: true,
      stdio: 'ignore',
      shell: true,
    }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

export { DAEMON_URL, UI_URL, LOG_FILE };
