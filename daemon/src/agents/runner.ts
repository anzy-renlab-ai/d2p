import { callClaude, type CallClaudeOpts } from '../subproc/claude.js';
import { renderPrompt } from '../prompts/render.js';
import { Queries } from '../storage/queries.js';
import { sseHub } from '../log/sse.js';
import type { ClaudeCallResult, ClaudeRole, ClaudeModel, LogEventKind } from '../types.js';
import { PROMPTS_VERSION } from '../prompts/version.js';
import { getActiveEngine, getCriticEngine } from '../engines/registry.js';
import { CRITIC_ROLES } from '../engines/router.js';

export interface RunAgentOpts<T> {
  role: ClaudeRole;
  model: ClaudeModel;
  promptInputs: Record<string, string>;
  cwd?: string;
  sessionId: number;
  gapId?: number | undefined;
  fixId?: number | undefined;
  schemaCheck?: CallClaudeOpts<T>['schemaCheck'];
  thoughtSummary?: string; // short Chinese label for run log
  timeoutMs?: number;
}

export async function runAgent<T>(
  q: Queries,
  opts: RunAgentOpts<T>,
): Promise<ClaudeCallResult<T>> {
  const startEvent = q.insertLogEvent(opts.sessionId, 'info', 'AGENT_START', {
    role: opts.role,
    model: opts.model,
    gapId: opts.gapId ?? null,
    fixId: opts.fixId ?? null,
    thought: opts.thoughtSummary ?? `running ${opts.role}`,
  });
  sseHub.publish({
    id: startEvent.id,
    ts: startEvent.ts,
    kind: 'AGENT_START',
    level: 'info',
    payload: startEvent.payload,
  });

  const prompt = renderPrompt(opts.role, opts.promptInputs);
  const callOpts: CallClaudeOpts<T> = {
    role: opts.role,
    model: opts.model,
    prompt,
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.schemaCheck !== undefined ? { schemaCheck: opts.schemaCheck } : {}),
  };
  const result = await callClaude<T>(callOpts);

  const endKind: LogEventKind = result.ok ? 'AGENT_END' : 'ERROR';
  const payload: Record<string, unknown> = {
    role: opts.role,
    model: opts.model,
    gapId: opts.gapId ?? null,
    fixId: opts.fixId ?? null,
    ok: result.ok,
  };
  if (!result.ok) {
    payload.code = result.code;
    payload.message = result.message;
  }
  const endEvent = q.insertLogEvent(opts.sessionId, result.ok ? 'info' : 'error', endKind, payload);
  sseHub.publish({
    id: endEvent.id,
    ts: endEvent.ts,
    kind: endKind,
    level: result.ok ? 'info' : 'error',
    payload: endEvent.payload,
  });

  // record cost + run row regardless of ok
  if (result.ok) {
    // F4 — capture which engine actually answered so the attribution panel
    // can split worker vs critic spend, and pull cache token counts when
    // the provider exposes them (anthropic always; openai-compat per-provider).
    const isCritic = CRITIC_ROLES.has(opts.role);
    const engineId = isCritic ? getCriticEngine().id : getActiveEngine().id;
    q.insertCostRecord(
      opts.sessionId,
      opts.role,
      opts.model,
      result.usage.inputTokens,
      result.usage.outputTokens,
      engineId,
      result.usage.cacheReadTokens ?? 0,
      result.usage.cacheWriteTokens ?? 0,
    );
  }

  void PROMPTS_VERSION;
  return result;
}
