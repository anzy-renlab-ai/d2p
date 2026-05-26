/**
 * Runtime test runner — orchestration entry point (Phase 6 §index).
 *
 * Pipeline:
 *   1. detectRuntime(cwd) — returns null → caller skips runtime tests entirely.
 *   2. launchRuntime — spawns demo, waits for port. On failure → returns
 *      inconclusive results for every spec with the launch error attached.
 *   3. For each spec: specToHttpTest → runHttpTest → translate
 *      HttpTestResult into TestCaseResult (Phase 5 shape) so the caller can
 *      merge runtime + static result sets transparently.
 *   4. finally: process.kill (always).
 */
import type { TrackLogger } from '../../log-types.js';
import { logCatch } from '../../log/branch.js';
import type { EngineConfig } from '../../stubs.js';
import { engineFamily } from '../../stubs.js';
import type { TestCaseResult, TestCaseSpec } from '../types.js';
import { detectRuntime } from './runtime-detector.js';
import { launchRuntime } from './process-launcher.js';
import { runHttpTest } from './http-tester.js';
import { specToHttpTest, type SpecLlmCaller } from './spec-to-http.js';
import type { HttpTestResult, HttpTestSpec, RuntimeProcess } from './types.js';

export interface RunRuntimeTestsOptions {
  logger?: TrackLogger | null;
  criticConfig: EngineConfig | null;
  criticApiKey: string | null;
  /** Optional override for the spec→http LLM call (mostly for tests). */
  specCallLLM?: SpecLlmCaller;
  /** Override runtime launch readyTimeout. */
  readyTimeoutMs?: number;
  /** Override port-poll interval — mainly for tests. */
  pollIntervalMs?: number;
  /** Per-HTTP-call timeout (default 5s). */
  httpTimeoutMs?: number;
}

export interface RuntimeRunOutput {
  results: TestCaseResult[];
  runtime: RuntimeProcess | null;
}

export async function runRuntimeTests(
  specs: TestCaseSpec[],
  cwd: string,
  opts: RunRuntimeTestsOptions,
): Promise<RuntimeRunOutput> {
  const logger = opts.logger ?? null;
  if (logger) {
    logger.log('info', 'agent.runtime.run.start', {
      cwd,
      specCount: specs.length,
      hasCritic: !!(opts.criticConfig && opts.criticApiKey),
    });
  }

  // 1. Detect runtime
  const detected = await detectRuntime(cwd, logger);
  if (!detected) {
    if (logger) {
      logger.log('info', 'agent.runtime.run.complete', {
        results: 0,
        runtime: null,
        reason: 'no-runtime-detected',
      });
    }
    return { results: [], runtime: null };
  }

  // 2. Launch
  let proc: RuntimeProcess;
  try {
    proc = await launchRuntime(detected, {
      cwd,
      logger,
      ...(opts.readyTimeoutMs !== undefined ? { readyTimeoutMs: opts.readyTimeoutMs } : {}),
      ...(opts.pollIntervalMs !== undefined ? { pollIntervalMs: opts.pollIntervalMs } : {}),
    });
  } catch (err) {
    logCatch(logger, 'agent.runtime.run.launch-failure', err, { cwd });
    const msg = err instanceof Error ? err.message : String(err);
    // Return inconclusive results for every spec so the caller can still
    // surface that the runtime layer was attempted but failed.
    const results = specs.map<TestCaseResult>((spec) => ({
      spec,
      status: 'inconclusive',
      verdictReason: `runtime launch failed: ${msg.slice(0, 200)}`,
      evidence: { file: spec.scope.file, line: spec.scope.line },
      criticFamily: opts.criticConfig ? engineFamily(opts.criticConfig) : null,
      durationMs: 0,
    }));
    if (logger) {
      logger.log('warn', 'agent.runtime.run.complete', {
        results: results.length,
        runtime: null,
        reason: 'launch-failed',
      });
    }
    return { results, runtime: null };
  }

  // 3. Run tests serially with guaranteed cleanup
  const results: TestCaseResult[] = [];
  try {
    for (const spec of specs) {
      const start = Date.now();
      const httpSpec = await specToHttpTest(spec, {
        logger,
        criticConfig: opts.criticConfig,
        criticApiKey: opts.criticApiKey,
        ...(opts.specCallLLM ? { callLLM: opts.specCallLLM } : {}),
      });
      if (!httpSpec) {
        results.push({
          spec,
          status: 'skipped',
          verdictReason: 'spec not HTTP-testable (no heuristic match, no LLM available, or LLM returned null)',
          evidence: { file: spec.scope.file, line: spec.scope.line },
          criticFamily: opts.criticConfig ? engineFamily(opts.criticConfig) : null,
          durationMs: Date.now() - start,
        });
        continue;
      }
      const httpResult = await runHttpTest(
        httpSpec,
        proc,
        logger,
        opts.httpTimeoutMs !== undefined ? { timeoutMs: opts.httpTimeoutMs } : undefined,
      );
      results.push(toTestCaseResult(spec, httpResult, opts.criticConfig));
    }
  } finally {
    // 4. Cleanup — always.
    try {
      await proc.kill();
    } catch (err) {
      logCatch(logger, 'agent.runtime.run.cleanup-error', err, {});
    }
  }

  if (logger) {
    logger.log('info', 'agent.runtime.run.complete', {
      results: results.length,
      runtime: { pid: proc.pid, port: proc.port },
      pass: results.filter((r) => r.status === 'pass').length,
      fail: results.filter((r) => r.status === 'fail').length,
      inconclusive: results.filter((r) => r.status === 'inconclusive').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
    });
  }

  return { results, runtime: proc };
}

function toTestCaseResult(
  spec: TestCaseSpec,
  http: HttpTestResult,
  criticConfig: EngineConfig | null,
): TestCaseResult {
  const expectedBehavior =
    spec.then ||
    (http.spec.expectedStatus !== undefined
      ? `HTTP ${http.spec.expectedStatus}`
      : 'unspecified');
  const actualBehavior =
    http.actualStatus !== undefined
      ? `HTTP ${http.actualStatus} ${truncatePreview(http.actualBody)}`
      : 'no response';
  return {
    spec,
    status: http.status === 'pass' ? 'pass' : http.status === 'fail' ? 'fail' : 'inconclusive',
    verdictReason: http.verdictReason,
    evidence: {
      file: spec.scope.file,
      line: spec.scope.line,
      snippet: snippetFromHttp(http.spec),
      expectedBehavior,
      actualBehavior,
    },
    criticFamily: criticConfig ? engineFamily(criticConfig) : null,
    durationMs: http.durationMs,
  };
}

function snippetFromHttp(spec: HttpTestSpec): string {
  const bodyStr = spec.body !== undefined ? ' ' + JSON.stringify(spec.body) : '';
  return `${spec.method} ${spec.path}${bodyStr}`;
}

function truncatePreview(body: unknown): string {
  if (body === undefined) return '';
  try {
    const s = typeof body === 'string' ? body : JSON.stringify(body);
    return s.slice(0, 120);
  } catch {
    return String(body).slice(0, 120);
  }
}

// Re-export shared surfaces so callers have a single import root.
export type {
  DetectedRuntime,
  HttpTestResult,
  HttpTestSpec,
  RuntimeProcess,
  RuntimeStrategy,
} from './types.js';
export { detectRuntime } from './runtime-detector.js';
export { launchRuntime } from './process-launcher.js';
export { runHttpTest } from './http-tester.js';
export { specToHttpTest } from './spec-to-http.js';
