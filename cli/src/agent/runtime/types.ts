/**
 * Runtime test runner shared types (Phase 6).
 *
 * Surface: docs/plans/2026-05-26-phase-6-7-runtime-presets.md
 *          §"Phase 6 — Runtime Test Runner"
 *
 * Track R owns this module. v1 is Node.js-only (Next.js / Vite / node script).
 */

/** Strategy decided by {@link detectRuntime} from the project's package.json. */
export type RuntimeStrategy =
  | 'next-dev'        // scripts.dev runs `next dev` / `next` (default port 3000)
  | 'next-start'      // scripts.start runs `next start` (default port 3000)
  | 'node-script'     // scripts.dev / scripts.start runs `node <file>` or `tsx <file>`
  | 'vite-dev'        // scripts.dev runs `vite` / `vite dev` (default port 5173)
  | 'unknown';        // No detectable Node.js runtime — caller skips runtime tests.

/** Detected runtime, ready to be passed to {@link launchRuntime}. */
export interface DetectedRuntime {
  strategy: RuntimeStrategy;
  /** Command to invoke (e.g. 'pnpm', 'npm', 'node', 'npx'). */
  command: string;
  /** Argv for the command (e.g. ['run', 'dev']). */
  args: string[];
  /** Port the runtime is expected to listen on once ready. */
  expectedPort: number;
  /** How long to wait for the port before declaring launch failure. */
  readyTimeoutMs: number;
  /** Extra env vars to inject when spawning. Inherited env is preserved. */
  envVars: Record<string, string>;
}

/** Handle to a running demo process. `kill` is idempotent and crash-safe. */
export interface RuntimeProcess {
  pid: number;
  port: number;
  baseUrl: string;             // 'http://localhost:<port>'
  startTime: number;           // Date.now() at the moment ready was detected
  kill: () => Promise<void>;
}

/** HTTP test specification — produced by {@link specToHttpTest}. */
export interface HttpTestSpec {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;                // '/api/login'
  headers?: Record<string, string>;
  body?: unknown;              // JSON-serialisable; non-undefined → send as JSON body
  expectedStatus?: number;
  expectedBodyShape?: unknown; // JSON-contains assertion (see http-tester.ts)
}

/** Single-request result. `status` mirrors TestCaseStatus minus 'skipped'. */
export interface HttpTestResult {
  spec: HttpTestSpec;
  status: 'pass' | 'fail' | 'inconclusive';
  actualStatus?: number;
  actualBody?: unknown;
  actualHeaders?: Record<string, string>;
  verdictReason: string;
  durationMs: number;
}
