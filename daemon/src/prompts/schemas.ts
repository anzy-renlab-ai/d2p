// Zod schemas for agent outputs. Used by callClaude schema check.

import { z } from 'zod';
import { ALL_PROJECT_TYPES, ALL_GAP_CATEGORIES } from '../types.js';

export const ProjectTypeSchema = z.enum(ALL_PROJECT_TYPES as unknown as [string, ...string[]]);
export const GapCategorySchema = z.enum(
  ALL_GAP_CATEGORIES as unknown as [string, ...string[]],
);
export const SeveritySchema = z.enum(['P1', 'P2', 'P3']);
export const GapSourceSchema = z.enum(['preset', 'vision', 'both']);
export const VerdictSchema = z.enum(['APPROVE', 'RETRY_WITH_HINTS', 'ROLLBACK', 'ESCALATE']);
export const ReasonCodeSchema = z.enum([
  'OK',
  'DIVERGES_FROM_GAP',
  'BUGGY',
  'INCOMPLETE',
  'OVER_SCOPED',
  'ARCHITECTURAL',
  'SCOPE_TOO_LARGE',
  'TOO_HARD',
]);

export const DetectorOutputSchema = z.object({
  type: ProjectTypeSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  preset_candidates: z.array(ProjectTypeSchema),
  inferred_check_commands: z.object({
    build: z.string(),
    test: z.string(),
    typecheck: z.string(),
  }),
});

const VisionQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.object({ label: z.string(), description: z.string() })),
});
export const VisionRoundOutputSchema = z.discriminatedUnion('done', [
  z.object({ done: z.literal(false), questions: z.array(VisionQuestionSchema) }),
  z.object({ done: z.literal(true), vision_md: z.string().min(1) }),
]);

const DifferGapSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  title: z.string().min(1),
  body: z.string().min(1),
  category: GapCategorySchema,
  severity: SeveritySchema,
  source: GapSourceSchema,
  suggested_approach: z.string().min(1),
  expected_files_changed: z.array(z.string()),
});
export const DifferOutputSchema = z.object({
  gaps: z.array(DifferGapSchema),
  preset_status: z.array(
    z.object({
      item: z.string(),
      status: z.enum(['done', 'partial', 'missing']),
      note: z.string().nullable().optional(),
    }),
  ),
});

export const ImplementerOutputSchema = z.object({
  files_changed: z.array(z.string()),
  commands_run: z.array(z.string()),
  test_output_excerpt: z.string(),
  commit_sha: z.string().min(7),
  residual_risks: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const AlignmentOutputSchema = z.object({
  alignment: z.number().min(0).max(1),
  addresses_gap: z.boolean(),
  scope_creep: z.boolean(),
  concerns: z.array(z.string()),
});

const SplitGapSpecSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  title: z.string().min(1),
  body: z.string().min(1),
});

export const BehavioralOutputSchema = z.object({
  verdict: VerdictSchema,
  confidence: z.number().min(0).max(1),
  reason_code: ReasonCodeSchema,
  rationale: z.string().min(1),
  hints: z.array(z.string()),
  split_into: z.array(SplitGapSpecSchema).nullable(),
  difficulty: z.number().int().min(1).max(5),
});

export const AdversarialOutputSchema = z.object({
  attempts: z.array(
    z.object({
      vector: z.string(),
      scenario: z.string(),
      broke: z.boolean(),
      evidence: z.string(),
    }),
  ),
  any_break: z.boolean(),
});

export const DoneCheckOutputSchema = z.object({
  vision_satisfied: z.boolean(),
  rationale: z.string(),
  remaining_themes: z.array(
    z.object({
      theme: z.string(),
      why_missing: z.string(),
      suggested_gap_slug: z.string(),
    }),
  ),
});

export const RepoSummarySchema = z.object({
  entry_points: z.array(z.string()),
  frameworks: z.array(z.string()),
  test_present: z.boolean(),
  auth_present: z.boolean(),
  db_present: z.enum(['sqlite', 'postgres', 'mysql', 'in-memory', 'none', 'unknown']),
  deploy_config_present: z.boolean(),
  ci_present: z.boolean(),
  license_present: z.boolean(),
  readme_quality: z.enum(['rich', 'minimal', 'none']),
  notable_deps: z.array(z.string()),
});
