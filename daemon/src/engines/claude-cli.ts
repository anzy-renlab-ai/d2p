import { runSubproc } from '../subproc/spawn.js';
import type { ClaudeCallResult, ClaudeModel, TokenUsage } from '../types.js';
import type { LLMEngine, EngineCallOpts } from './types.js';
import type { ClaudeCliEngineConfig } from '../config/types.js';

const ROLE_TIMEOUTS_MS: Record<string, number> = {
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

function stripUsageTail(stdout: string): string {
  return stdout.replace(/\r/g, '').replace(/\n?USAGE:[^\n]*\n?/g, '\n').trim();
}

export function extractTokenUsage(stdout: string): TokenUsage {
  const m = /USAGE:\s*input=(\d+)\s*output=(\d+)/.exec(stdout);
  if (m && m[1] && m[2]) {
    return { inputTokens: parseInt(m[1], 10), outputTokens: parseInt(m[2], 10) };
  }
  return { inputTokens: 0, outputTokens: 0 };
}

export class ClaudeCliEngine implements LLMEngine {
  readonly id = 'claude-cli';
  private readonly bin: string;

  constructor(cfg: ClaudeCliEngineConfig) {
    this.bin = cfg.bin ?? process.env.D2P_CLAUDE_BIN ?? 'claude';
  }

  async call<T = unknown>(opts: EngineCallOpts<T>): Promise<ClaudeCallResult<T>> {
    const timeoutMs = opts.timeoutMs ?? ROLE_TIMEOUTS_MS[opts.role] ?? 120_000;
    const args = ['--model', MODEL_CLI_ID[opts.model], '-p', opts.prompt];
    const r = await runSubproc({ cmd: this.bin, args, cwd: opts.cwd, timeoutMs });
    if (r.timedOut) {
      return { ok: false, code: 'TIMEOUT', message: `timed out after ${timeoutMs}ms`, raw: r.stdout };
    }
    if (r.spawnError && /ENOENT/.test(r.spawnError)) {
      return { ok: false, code: 'CLAUDE_NOT_FOUND', message: r.spawnError, raw: '' };
    }
    if (r.exitCode !== 0) {
      return {
        ok: false,
        code: 'NON_ZERO_EXIT',
        message: `exit ${r.exitCode}: ${r.stderr.slice(0, 500)}`,
        raw: r.stdout,
      };
    }
    const cleaned = stripUsageTail(r.stdout);
    let json: unknown;
    try {
      json = JSON.parse(cleaned);
    } catch (e) {
      return { ok: false, code: 'NON_JSON', message: (e as Error).message, raw: r.stdout };
    }
    if (opts.schemaCheck && !opts.schemaCheck(json)) {
      return { ok: false, code: 'SCHEMA', message: 'schema check failed', raw: r.stdout };
    }
    return { ok: true, json: json as T, raw: r.stdout, usage: extractTokenUsage(r.stdout) };
  }

  async probe(): Promise<{ ok: boolean; detail?: string }> {
    const r = await runSubproc({ cmd: this.bin, args: ['--version'], timeoutMs: 5000 });
    return r.exitCode === 0 && !r.spawnError
      ? { ok: true, detail: r.stdout.trim() }
      : { ok: false, detail: r.spawnError ?? (r.stderr.trim() || `exit ${r.exitCode}`) };
  }
}
