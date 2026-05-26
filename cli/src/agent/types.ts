/**
 * Agent shared types (Phase 4).
 *
 * Surface authority: `docs/plans/2026-05-26-phase-4-agent-orchestrator.md` §"agent/types.ts".
 *
 * Track A owns this file. Track B reads it via stub during parallel dispatch
 * and the lead integrates the real one during Round 2.
 */

/** The 12 canonical audit categories the agent reasons about. */
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

/** All 12 categories as a static array (for iteration / mapping). */
export const ALL_AUDIT_CATEGORIES: readonly AuditCategory[] = [
  'secrets',
  'auth',
  'authz',
  'db',
  'security',
  'observability',
  'error-handling',
  'tests',
  'perf',
  'llm-cost',
  'gdpr',
  'deploy-incident',
] as const;

/**
 * Inferred shape of the project under audit. Produced by `detectProject`.
 *
 * Evidence is a free-form bag of "what we read to reach this conclusion" so
 * the log trail (and future debugging) can show the raw inputs.
 */
export interface ProjectProfile {
  framework: string;          // 'next.js' | 'vite' | 'express' | 'unknown' | ...
  backend: string | null;     // 'supabase' | 'firebase' | 'custom-express' | null
  language: string[];         // ['typescript', 'sql', ...]
  hasGit: boolean;
  hasTests: boolean;          // detected via package.json scripts or tests dir
  hasEnvFile: boolean;        // .env or .env.example present
  packageMgr: 'npm' | 'pnpm' | 'yarn' | null;
  evidence: Record<string, string>;
}

/** One row in the agent's "what to test" checklist. */
export interface ChecklistItem {
  category: AuditCategory;
  priority: 'high' | 'medium' | 'low' | 'skip';
  reasoning: string;
  presetIds: string[];        // existing preset ids covering this category
}

/** A single agent decision point — recorded for replay / debugging. */
export interface AgentDecision {
  ts: number;
  step: string;               // e.g. 'project-detection' | 'checklist-build'
  decision: string;           // e.g. 'use-preset' | 'skip' | 'llm-judgment'
  reasoning: string;
  evidence?: unknown;
}
