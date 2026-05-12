import { Command } from 'commander';
import {
  daemonReachable,
  readPid,
  clearPid,
  spawnDaemon,
  pidAlive,
  pollUntilReachable,
  openBrowser,
  DAEMON_URL,
  UI_URL,
  LOG_FILE,
} from './daemon-control.js';

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program.name('d2p').description('demo to product').version('0.1.0');

  program
    .command('start')
    .option('--no-open', "don't open browser")
    .option('--prod', 'run daemon in built (prod) mode')
    .action(async (opts: { open: boolean; prod?: boolean }) => {
      if (await daemonReachable()) {
        console.log(`daemon already up at ${DAEMON_URL}`);
        if (opts.open !== false) openBrowser(UI_URL);
        return;
      }
      const pid = spawnDaemon(!opts.prod);
      console.log(`daemon spawned (pid ${pid}); log: ${LOG_FILE}`);
      const ok = await pollUntilReachable(30_000);
      if (!ok) {
        console.error(`daemon did not become reachable in 30s; see ${LOG_FILE}`);
        process.exit(1);
      }
      console.log(`daemon ready at ${DAEMON_URL}`);
      if (opts.open !== false) openBrowser(UI_URL);
    });

  program.command('stop').action(async () => {
    const pid = readPid();
    if (!pid || !pidAlive(pid)) {
      clearPid();
      console.log('no daemon running');
      return;
    }
    process.kill(pid, 'SIGTERM');
    const start = Date.now();
    while (Date.now() - start < 5000) {
      if (!pidAlive(pid)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (pidAlive(pid)) {
      console.warn(`daemon (pid ${pid}) did not exit; sending SIGKILL`);
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // ignore
      }
    }
    clearPid();
    console.log('daemon stopped');
  });

  program.command('status').action(async () => {
    const pid = readPid();
    const alive = pid !== null && pidAlive(pid);
    const reach = await daemonReachable();
    console.log(JSON.stringify({ pid, alive, reachable: reach, daemonUrl: DAEMON_URL }, null, 2));
  });

  program.command('open').action(() => {
    openBrowser(UI_URL);
  });

  program.command('doctor').action(async () => {
    if (!(await daemonReachable())) {
      console.error(`daemon not reachable at ${DAEMON_URL}. run 'd2p start' first.`);
      process.exit(1);
    }
    const r = await fetch(`${DAEMON_URL}/api/doctor`).then((x) => x.json() as Promise<{
      ok: boolean;
      checks: { name: string; ok: boolean; detail?: string }[];
    }>);
    for (const c of r.checks) {
      const mark = c.ok ? '✓' : '✗';
      const tail = c.detail ? `: ${c.detail}` : '';
      console.log(`${mark} ${c.name}${tail}`);
    }
    process.exit(r.ok ? 0 : 1);
  });

  program
    .command('install-service')
    .description('install daemon as a system service (not implemented in MVP-0)')
    .action(() => {
      console.error('not implemented in MVP-0. run `d2p start` manually for now.');
      process.exit(2);
    });

  program
    .command('uninstall-service')
    .description('uninstall daemon system service (not implemented in MVP-0)')
    .action(() => {
      console.error('not implemented in MVP-0.');
      process.exit(2);
    });

  await program.parseAsync(argv);
}
