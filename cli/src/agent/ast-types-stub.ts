/**
 * STUB — temporary placeholder for FunctionInfo until Track 8A
 * (`agent/ast-analyzer.ts`) lands.
 *
 * During Phase 8 integration the lead deletes this file and the
 * test-emitter imports `FunctionInfo` from `./ast-analyzer.js` instead.
 *
 * Mirror of the contract in
 * `docs/plans/2026-05-26-phase-8-real-tests-progressive-report.md`
 * §"agent/ast-analyzer.ts (Track 8A)".
 */
export interface FunctionInfo {
  file: string;
  line: number;
  name: string;
  kind: 'endpoint' | 'function';
  params: Array<{ name: string; typeHint: string | null }>;
  returnTypeHint: string | null;
  branchCount: number;
  hasAsyncCall: boolean;
  hasDatabaseCall: boolean;
  hasNetworkCall: boolean;
  sourceSnippet: string;
}
