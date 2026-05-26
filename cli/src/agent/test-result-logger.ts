/**
 * Per-test detailed logging helpers (Phase 5).
 *
 * Surface: docs/plans/2026-05-26-phase-5-test-case-agent.md
 *          §"agent/test-result-logger.ts"
 *
 * Each test case emits a sub-trace under track='agent'. The pattern is:
 *   1. logTestCaseStart(logger, spec)
 *   2. logTestContextRead(logger, { file, lineStart, lineEnd, snippet })
 *   3. logTestLlmCall(logger, { ... phase: 'start' })
 *      logTestLlmCall(logger, { ... phase: 'success' | 'failure' })
 *   4. logTestResult(logger, result)
 *
 * All helpers must be crash-safe with a partially-formed logger — same
 * contract as `logBranch`.
 */
import type { TrackLogger } from '../log-types.js';
import type { TestCaseSpec, TestCaseResult } from './test-types-stub.js';

/**
 * Emit the start of a test case.
 *
 * Event: `agent.test-run.case.start`
 */
export function logTestCaseStart(logger: TrackLogger, spec: TestCaseSpec): void {
  if (!logger || typeof logger.log !== 'function') return;
  try {
    logger.log('info', 'agent.test-run.case.start', {
      specId: spec.id,
      name: spec.name,
      category: spec.category,
      target: spec.scope.target,
      file: spec.scope.file,
      line: spec.scope.line,
    });
  } catch {
    /* swallow */
  }
}

export interface ContextReadInfo {
  file: string;
  lineStart: number;
  lineEnd: number;
  snippet: string;
}

/**
 * Emit a context-read event recording which lines around the spec target
 * were extracted for the LLM prompt.
 *
 * Event: `agent.test-run.case.context-read`
 */
export function logTestContextRead(logger: TrackLogger, info: ContextReadInfo): void {
  if (!logger || typeof logger.log !== 'function') return;
  try {
    logger.log('debug', 'agent.test-run.case.context-read', {
      file: info.file,
      lineStart: info.lineStart,
      lineEnd: info.lineEnd,
      lines: Math.max(0, info.lineEnd - info.lineStart + 1),
      snippetPreview: (info.snippet ?? '').slice(0, 200),
    });
  } catch {
    /* swallow */
  }
}

export type LlmCallPhase = 'start' | 'success' | 'failure';

export interface LlmCallInfo {
  specId: string;
  model: string;
  promptLen: number;
  phase: LlmCallPhase;
  error?: string;
  rawLen?: number;
  durationMs?: number;
}

/**
 * Emit one of three LLM-call events depending on `phase`. Failure logs at
 * warn level; start/success log at debug.
 */
export function logTestLlmCall(logger: TrackLogger, info: LlmCallInfo): void {
  if (!logger || typeof logger.log !== 'function') return;
  try {
    if (info.phase === 'start') {
      logger.log('debug', 'agent.test-run.case.llm-call.start', {
        specId: info.specId,
        model: info.model,
        promptLen: info.promptLen,
      });
      return;
    }
    if (info.phase === 'success') {
      logger.log('debug', 'agent.test-run.case.llm-call.success', {
        specId: info.specId,
        model: info.model,
        promptLen: info.promptLen,
        rawLen: info.rawLen ?? 0,
        durationMs: info.durationMs ?? 0,
      });
      return;
    }
    // failure
    logger.log('warn', 'agent.test-run.case.llm-call.failure', {
      specId: info.specId,
      model: info.model,
      promptLen: info.promptLen,
      error: (info.error ?? 'unknown error').slice(0, 300),
      durationMs: info.durationMs ?? 0,
    });
  } catch {
    /* swallow */
  }
}

/**
 * Emit the terminal verdict event for a test case. Fails surface at warn,
 * everything else at info.
 *
 * Event: `agent.test-run.case.complete`
 */
export function logTestResult(logger: TrackLogger, result: TestCaseResult): void {
  if (!logger || typeof logger.log !== 'function') return;
  try {
    const level = result.status === 'fail' ? 'warn' : 'info';
    logger.log(level, 'agent.test-run.case.complete', {
      specId: result.spec.id,
      status: result.status,
      verdictReason: (result.verdictReason ?? '').slice(0, 300),
      evidenceFile: result.evidence?.file,
      evidenceLine: result.evidence?.line,
      evidenceSnippetPreview: result.evidence?.snippet?.slice(0, 200),
      criticFamily: result.criticFamily,
      durationMs: result.durationMs,
    });
  } catch {
    /* swallow */
  }
}
