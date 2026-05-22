// OpenAI Codex CLI (https://github.com/openai/codex) subprocess engine.
// Mirrors claude-cli.ts shape — same LLMEngine contract — so the registry /
// factory / router don't care which CLI is under the hood.
//
// Invocation (codex CLI non-interactive exec subcommand):
//   codex exec --model <model-id> "<prompt>"
//
// TODO(verify): Confirm exact flag spelling against the installed codex CLI
// version (`codex exec --help`). The argv order below is a conservative
// placeholder mirroring what the OpenAI docs publish; if real codex requires
// e.g. `-m` instead of `--model`, or the prompt over stdin, swap here. Engine
// callers stay unchanged.

import { runSubproc, type SpawnResult, type SpawnOpts } from '../subproc/spawn.js';
import type { ClaudeCallResult, ClaudeModel, TokenUsage } from '../types.js';
import type { LLMEngine, EngineCallOpts } from './types.js';
import type { CodexCliEngineConfig } from '../config/types.js';
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

/** Default model id mapping when the user doesn't override via config.models.
 *  Codex CLI accepts OpenAI hosted model ids. */
const DEFAULT_CODEX_MODEL: Record<ClaudeModel, string> = {
  haiku: 'gpt-5-mini',
  sonnet: 'gpt-5',
  opus: 'gpt-5',
};

// Test seam — keep production code path identical to claude-cli (direct
// import), but let tests inject a stub without spinning a real subprocess.
type Runner = (opts: SpawnOpts) => Promise<SpawnResult>;
let runnerOverride: Runner | null = null;
/** Test-only — swap the subprocess runner. Pass null to restore the default. */
export function __setRunnerForTests(r: Runner | null): void {
  runnerOverride = r;
}
function getRunner(): Runner {
  return runnerOverride ?? runSubproc;
}

/** Codex CLI does not (yet) emit a structured USAGE: tail like claude-cli.
 *  We surface zero-usage; cost tracking is the wrapper's responsibility once
 *  the CLI exposes token counts. */
function extractTokenUsage(_stdout: string): TokenUsage {
  return { inputTokens: 0, outputTokens: 0 };
}

/** Detect common auth-failure stderr messages and surface them as NON_ZERO_EXIT
 *  with a clearer hint. Heuristic — codex may evolve its error text. */
function looksLikeAuthError(stderr: string): boolean {
  return /not\s+logged\s+in|please\s+login|auth(entication)?\s+(failed|required|error)|OPENAI_API_KEY|unauthor[ie]zed/i.test(
    stderr,
  );
}

export class CodexCliEngine implements LLMEngine {
  readonly id = 'codex-cli';
  private readonly bin: string;
  private readonly models: Record<ClaudeModel, string>;

  constructor(cfg: CodexCliEngineConfig) {
    this.bin = cfg.bin ?? process.env.D2P_CODEX_BIN ?? 'codex';
    this.models = {
      haiku: cfg.models?.haiku ?? DEFAULT_CODEX_MODEL.haiku,
      sonnet: cfg.models?.sonnet ?? DEFAULT_CODEX_MODEL.sonnet,
      opus: cfg.models?.opus ?? DEFAULT_CODEX_MODEL.opus,
    };
  }

  async call<T = unknown>(opts: EngineCallOpts<T>): Promise<ClaudeCallResult<T>> {
    const timeoutMs = opts.timeoutMs ?? ROLE_TIMEOUTS_MS[opts.role] ?? 120_000;
    const args = ['exec', '--model', this.models[opts.model], opts.prompt];
    const r = await getRunner()({ cmd: this.bin, args, cwd: opts.cwd, timeoutMs });
    if (r.timedOut) {
      return { ok: false, code: 'TIMEOUT', message: `timed out after ${timeoutMs}ms`, raw: r.stdout };
    }
    if (r.spawnError && /ENOENT/.test(r.spawnError)) {
      return { ok: false, code: 'CLAUDE_NOT_FOUND', message: r.spawnError, raw: '' };
    }
    if (r.exitCode !== 0) {
      const hint = looksLikeAuthError(r.stderr) ? ' (auth check failed; run `codex login`)' : '';
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
