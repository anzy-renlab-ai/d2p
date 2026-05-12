import { runSubproc, type SpawnResult } from './spawn.js';
import type { GitResult } from '../types.js';

const GIT_BIN = process.env.D2P_GIT_BIN ?? 'git';

export async function git(
  args: string[],
  cwd: string,
  opts: { timeoutMs?: number } = {},
): Promise<GitResult> {
  const r: SpawnResult = await runSubproc({
    cmd: GIT_BIN,
    args,
    cwd,
    timeoutMs: opts.timeoutMs ?? 30_000,
  });
  return {
    exitCode: r.exitCode ?? -1,
    stdout: r.stdout,
    stderr: r.stderr + (r.spawnError ? `\n[spawn-error: ${r.spawnError}]` : ''),
  };
}

export async function gitVersion(): Promise<string | null> {
  const r = await git(['--version'], process.cwd(), { timeoutMs: 5000 });
  if (r.exitCode !== 0) return null;
  return r.stdout.trim();
}
