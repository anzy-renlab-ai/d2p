#!/usr/bin/env node
// dev.mjs — one-shot start: daemon + UI Vite, both attached, shared SIGINT/SIGTERM.

import { spawn } from 'node:child_process';

const useShell = process.platform === 'win32';

function run(name, args, color) {
  const p = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: useShell });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  p.stdout.on('data', (b) => process.stdout.write(b.toString().replace(/^/gm, tag)));
  p.stderr.on('data', (b) => process.stderr.write(b.toString().replace(/^/gm, tag)));
  p.on('exit', (code) => {
    console.log(`${tag}exited with code ${code}`);
    process.exitCode = code ?? 1;
  });
  return p;
}

const daemon = run('daemon', ['run', 'dev', '-w', 'daemon'], '36');
const ui = run('ui', ['run', 'dev', '-w', 'ui'], '35');

let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  daemon.kill(sig);
  ui.kill(sig);
  setTimeout(() => process.exit(process.exitCode ?? 0), 2000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
