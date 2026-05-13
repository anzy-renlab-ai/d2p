// Thin facade kept for back-compat with existing agents/* callers.
// Real work delegated to engines/* (chosen by the active engine in registry).

import { runSubproc } from './spawn.js';
import type { ClaudeCallResult, ClaudeModel, ClaudeRole, TokenUsage } from '../types.js';
import { PROMPTS_VERSION } from '../prompts/version.js';
import { buildEngine } from '../engines/factory.js';
import { extractTokenUsage as cliExtract } from '../engines/claude-cli.js';
import { getActiveEngine } from '../engines/registry.js';

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

export interface CallClaudeOpts<T> {
  role: ClaudeRole;
  model: ClaudeModel;
  prompt: string;
  cwd?: string;
  timeoutMs?: number;
  schemaCheck?: (json: unknown) => json is T;
}

export async function callClaude<T = unknown>(opts: CallClaudeOpts<T>): Promise<ClaudeCallResult<T>> {
  const engine = getActiveEngine();
  return engine.call<T>({
    role: opts.role,
    model: opts.model,
    prompt: opts.prompt,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? ROLE_TIMEOUTS[opts.role],
    schemaCheck: opts.schemaCheck,
  });
}

export async function claudeVersion(): Promise<string | null> {
  const engine = getActiveEngine();
  if (engine.probe) {
    const p = await engine.probe();
    return p.ok ? (p.detail ?? engine.id) : null;
  }
  return engine.id;
}

export function extractTokenUsage(stdout: string): TokenUsage {
  return cliExtract(stdout);
}

export { buildEngine, PROMPTS_VERSION };

// Used in rare places that still want raw subproc invocation; internal only.
export async function _legacyRunSubproc(
  ...args: Parameters<typeof runSubproc>
): Promise<ReturnType<typeof runSubproc>> {
  return runSubproc(...args);
}
