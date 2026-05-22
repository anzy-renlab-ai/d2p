// Google Gemini CLI (https://github.com/google-gemini/gemini-cli) subprocess
// engine. Mirrors claude-cli.ts shape so the registry / factory / router
// don't care which CLI is under the hood.
//
// Invocation (gemini CLI non-interactive prompt mode):
//   gemini -p "<prompt>" --model <model-id>
//
// TODO(verify): Confirm exact flag spelling against the installed gemini CLI
// version (`gemini --help`). The argv order below mirrors the published
// non-interactive usage; if real gemini requires `-m` instead of `--model`
// or prompt-via-stdin, swap here without touching engine consumers.
//
// TODO(stdin): Same Win32 argv-length risk as codex-cli — large prompts via
// positional argv can exceed ~32K cap. gemini -p typically supports prompt
// via stdin (--stdin or piping). Swap to stdin model on first-machine smoke.

import { runSubproc, type SpawnResult, type SpawnOpts } from '../subproc/spawn.js';
import type { ClaudeCallResult, ClaudeModel, TokenUsage } from '../types.js';
import type { LLMEngine, EngineCallOpts } from './types.js';
import type { GeminiCliEngineConfig } from '../config/types.js';
import { tryParseJsonLoose } from './json-parse.js';

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

/** Default model id mapping for Google Gemini. Users can override via
 *  config.models. */
const DEFAULT_GEMINI_MODEL: Record<ClaudeModel, string> = {
  haiku: 'gemini-2.5-flash',
  sonnet: 'gemini-2.5-pro',
  opus: 'gemini-2.5-pro',
};

// Test seam — keep production path identical to claude-cli but let tests
// stub the subprocess without spinning a real CLI.
type Runner = (opts: SpawnOpts) => Promise<SpawnResult>;
let runnerOverride: Runner | null = null;
/** Test-only — swap the subprocess runner. Pass null to restore the default. */
export function __setRunnerForTests(r: Runner | null): void {
  runnerOverride = r;
}
function getRunner(): Runner {
  return runnerOverride ?? runSubproc;
}

function extractTokenUsage(_stdout: string): TokenUsage {
  return { inputTokens: 0, outputTokens: 0 };
}

function looksLikeAuthError(stderr: string): boolean {
  return /API\s*key|GEMINI_API_KEY|not\s+authenticated|please\s+(login|authenticate)|auth(entication)?\s+(failed|required|error)|unauthor[ie]zed/i.test(
    stderr,
  );
}

export class GeminiCliEngine implements LLMEngine {
  readonly id = 'gemini-cli';
  private readonly bin: string;
  private readonly models: Record<ClaudeModel, string>;

  constructor(cfg: GeminiCliEngineConfig) {
    this.bin = cfg.bin ?? process.env.D2P_GEMINI_BIN ?? 'gemini';
    this.models = {
      haiku: cfg.models?.haiku ?? DEFAULT_GEMINI_MODEL.haiku,
      sonnet: cfg.models?.sonnet ?? DEFAULT_GEMINI_MODEL.sonnet,
      opus: cfg.models?.opus ?? DEFAULT_GEMINI_MODEL.opus,
    };
  }

  async call<T = unknown>(opts: EngineCallOpts<T>): Promise<ClaudeCallResult<T>> {
    const timeoutMs = opts.timeoutMs ?? ROLE_TIMEOUTS_MS[opts.role] ?? 120_000;
    const args = ['-p', opts.prompt, '--model', this.models[opts.model]];
    const r = await getRunner()({ cmd: this.bin, args, cwd: opts.cwd, timeoutMs });
    if (r.timedOut) {
      return { ok: false, code: 'TIMEOUT', message: `timed out after ${timeoutMs}ms`, raw: r.stdout };
    }
    if (r.spawnError && /ENOENT/.test(r.spawnError)) {
      return { ok: false, code: 'CLAUDE_NOT_FOUND', message: r.spawnError, raw: '' };
    }
    if (r.exitCode !== 0) {
      const hint = looksLikeAuthError(r.stderr) ? ' (auth check failed; run `gemini auth login` or set GEMINI_API_KEY)' : '';
      return {
        ok: false,
        code: 'NON_ZERO_EXIT',
        message: `exit ${r.exitCode}: ${r.stderr.slice(0, 500)}${hint}`,
        raw: r.stdout,
      };
    }
    let json: unknown;
    try {
      json = tryParseJsonLoose(r.stdout);
    } catch (e) {
      return { ok: false, code: 'NON_JSON', message: (e as Error).message, raw: r.stdout };
    }
    if (opts.schemaCheck && !opts.schemaCheck(json)) {
      return { ok: false, code: 'SCHEMA', message: 'schema check failed', raw: r.stdout };
    }
    return { ok: true, json: json as T, raw: r.stdout, usage: extractTokenUsage(r.stdout) };
  }

  async probe(): Promise<{ ok: boolean; detail?: string }> {
    const r = await getRunner()({ cmd: this.bin, args: ['--version'], timeoutMs: 5000 });
    return r.exitCode === 0 && !r.spawnError
      ? { ok: true, detail: r.stdout.trim() }
      : { ok: false, detail: r.spawnError ?? (r.stderr.trim() || `exit ${r.exitCode}`) };
  }
}
