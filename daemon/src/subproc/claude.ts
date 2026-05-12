import { runSubproc } from './spawn.js';
import type { ClaudeCallResult, ClaudeModel, ClaudeRole, TokenUsage } from '../types.js';
import { PROMPTS_VERSION } from '../prompts/version.js';

const CLAUDE_BIN = process.env.D2P_CLAUDE_BIN ?? 'claude';

export const ROLE_TIMEOUTS: Record<ClaudeRole, number> = {
  detector: 60_000,
  vision: 60_000,
  differ: 180_000,
  implementer: 600_000,
  alignment: 60_000,
  behavioral: 180_000,
  adversarial: 180_000,
  'done-check': 180_000,
  'repo-summary': 60_000,
};

const MODEL_CLI_ID: Record<ClaudeModel, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
};

export interface CallClaudeOpts<T> {
  role: ClaudeRole;
  model: ClaudeModel;
  prompt: string;
  cwd?: string;
  timeoutMs?: number;
  schemaCheck?: (json: unknown) => json is T;
}

export async function callClaude<T = unknown>(opts: CallClaudeOpts<T>): Promise<ClaudeCallResult<T>> {
  const timeoutMs = opts.timeoutMs ?? ROLE_TIMEOUTS[opts.role];
  const args = ['--model', MODEL_CLI_ID[opts.model], '-p', opts.prompt];

  const result = await runSubproc({
    cmd: CLAUDE_BIN,
    args,
    cwd: opts.cwd,
    timeoutMs,
  });

  if (result.timedOut) {
    return { ok: false, code: 'TIMEOUT', message: `timed out after ${timeoutMs}ms`, raw: result.stdout };
  }
  if (result.spawnError && /ENOENT/.test(result.spawnError)) {
    return { ok: false, code: 'CLAUDE_NOT_FOUND', message: result.spawnError, raw: '' };
  }
  if (result.exitCode !== 0) {
    return {
      ok: false,
      code: 'NON_ZERO_EXIT',
      message: `exit ${result.exitCode}: ${result.stderr.slice(0, 500)}`,
      raw: result.stdout,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch (e) {
    return {
      ok: false,
      code: 'NON_JSON',
      message: (e as Error).message,
      raw: result.stdout,
    };
  }

  if (opts.schemaCheck && !opts.schemaCheck(json)) {
    return { ok: false, code: 'SCHEMA', message: 'schema check failed', raw: result.stdout };
  }

  return {
    ok: true,
    json: json as T,
    raw: result.stdout,
    usage: extractTokenUsage(result.stdout),
  };
}

/**
 * Try to extract token usage from the claude CLI output. Looks for a trailing
 * `USAGE: input=NNN output=NNN` line. Returns zeros if not present.
 */
export function extractTokenUsage(stdout: string): TokenUsage {
  const m = /USAGE:\s*input=(\d+)\s*output=(\d+)/.exec(stdout);
  if (m && m[1] && m[2]) {
    return { inputTokens: parseInt(m[1], 10), outputTokens: parseInt(m[2], 10) };
  }
  return { inputTokens: 0, outputTokens: 0 };
}

export async function claudeVersion(): Promise<string | null> {
  const r = await runSubproc({ cmd: CLAUDE_BIN, args: ['--version'], timeoutMs: 5000 });
  if (r.exitCode !== 0 || r.spawnError) return null;
  return r.stdout.trim();
}

export { PROMPTS_VERSION };
