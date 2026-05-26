/**
 * Agent shared types.
 *
 * STUB: real types are owned by Track A (`agent/project-detector.ts` /
 * `agent/checklist-builder.ts`). This file is a minimal Track-B stub so the
 * strategist / loop / orchestrator can compile in isolation. Integrator
 * (Track D) will replace this with the Track A authoritative version.
 *
 * Surface mirrored from
 * `docs/plans/2026-05-26-phase-4-agent-orchestrator.md` §"agent/types.ts".
 */

export type AuditCategory =
  | 'secrets'
  | 'auth'
  | 'authz'
  | 'db'
  | 'security'
  | 'observability'
  | 'error-handling'
  | 'tests'
  | 'perf'
  | 'llm-cost'
  | 'gdpr'
  | 'deploy-incident';

export interface ProjectProfile {
  framework: string; // 'next.js' | 'express' | 'unknown' | ...
  backend: string | null; // 'supabase' | 'firebase' | 'custom' | null
  language: string[]; // ['typescript', 'sql']
  hasGit: boolean;
  hasTests: boolean;
  hasEnvFile: boolean;
  packageMgr: 'npm' | 'pnpm' | 'yarn' | null;
  evidence: Record<string, string>;
}

export interface ChecklistItem {
  category: AuditCategory;
  priority: 'high' | 'medium' | 'low' | 'skip';
  reasoning: string;
  presetIds: string[];
}

export interface AgentDecision {
  ts: number;
  step: string;
  decision: string;
  reasoning: string;
  evidence?: unknown;
}
