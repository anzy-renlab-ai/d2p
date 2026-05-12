// Prompt templates for each agent role. Detail: docs/details/01-prompts.md.
// CAUTION: editing these without bumping prompts/version.ts breaks regression
// testing.

import type { ClaudeRole } from '../types.js';

export const TEMPLATES: Record<ClaudeRole, string> = {
  detector: String.raw`You analyze a code repository and identify its product type.

<tree-begin>
{{tree_dump}}
<tree-end>

<manifests-begin>
{{manifests}}
<manifests-end>

<readme-begin>
{{readme_head}}
<readme-end>

Identify the project type from this fixed set:
  saas-web | api-service | cli-tool | library | static-site | mobile | desktop-app | ml-script | unknown

Output JSON only, no other text, matching this schema:
{
  "type": "<one of the set above>",
  "confidence": <float 0..1>,
  "evidence": ["<short bullet>", "<short bullet>", "..."],
  "preset_candidates": ["<type1>", "<type2>"],
  "inferred_check_commands": {
    "build": "<command or empty string>",
    "test": "<command or empty string>",
    "typecheck": "<command or empty string>"
  }
}

Rules:
- evidence: 3-8 bullets, each <= 15 words, concrete (file names, deps, conventions)
- preset_candidates: top 2 plausible types in priority order
- inferred_check_commands: empty string if no command applies
- If genuinely unsure, type="unknown" with confidence reflecting that`,

  vision: String.raw`You are eliciting a product vision from the user by asking focused questions.

Detected project type: {{detected_type}}

Repository tree (shallow):
<tree-begin>
{{tree_short}}
<tree-end>

Drafts collected so far:
<drafts-begin>
{{drafts_so_far}}
<drafts-end>

Round {{round_index}} of 5 max.

Decide: continue eliciting OR finalize.

If continuing, output JSON only:
{
  "done": false,
  "questions": [
    {
      "id": "<short-kebab-id>",
      "question": "<one Chinese sentence>",
      "options": [
        {"label": "<short Chinese label>", "description": "<one Chinese sentence>"}
      ]
    }
  ]
}

If finalizing, output JSON only:
{
  "done": true,
  "vision_md": "<full markdown of the vision document>"
}

Rules:
- 1-3 questions per round, 3-4 options each, no open-ended
- Cover: target user, core scenarios, business model, KPI, explicit non-goals
- Don't repeat topics already in drafts
- Stop and finalize when: 5 rounds reached OR drafts cover all 5 themes above
- vision_md sections: ## 产品定位 / ## 目标用户 / ## 核心场景 / ## 商业模式 / ## KPI / ## 明确不做
- All user-facing text in Chinese
- Question id format: <round>-<theme>-<n>, e.g. "r2-monetize-1"`,

  differ: String.raw`You diff a code repository against a vision and a preset checklist to identify gaps.

<vision-begin>
{{vision_md}}
<vision-end>

<preset-begin>
{{preset_md}}
<preset-end>

<preset-overrides-begin>
{{preset_overrides}}
<preset-overrides-end>

<repo-summary-begin>
{{repo_summary}}
<repo-summary-end>

<history-begin>
{{done_gap_history}}
<history-end>

Output JSON only, no other text:
{
  "gaps": [
    {
      "slug": "<kebab-case-unique-id>",
      "title": "<one sentence Chinese>",
      "body": "<2-5 sentence Chinese, includes context and suggested approach>",
      "category": "<auth|input-validation|sql|ipc|file-ops|network|crypto|deploy|data|tests|docs|ui|perf|err|polish|misc>",
      "severity": "P1|P2|P3",
      "source": "preset|vision|both",
      "suggested_approach": "<one paragraph English, concrete>",
      "expected_files_changed": ["<path glob>", "..."]
    }
  ],
  "preset_status": [
    {"item": "<slug from preset>", "status": "done|partial|missing", "note": "<optional>"}
  ]
}

Rules:
- gap slug must not collide with any in history; if a topic already DONE, exclude
- Maximum 12 gaps per call; pick highest-impact
- severity P1 = blocks done-check; P2 = important polish; P3 = nice-to-have
- expected_files_changed: realistic file path globs
- preset_status: include EVERY item from preset (and any from overrides.add), one entry each`,

  implementer: String.raw`You are an implementer. Your task: implement ONE gap end-to-end in this git worktree.

Working directory: {{worktree_path}}
You may read/write/delete files within this directory only.
You may run shell commands (npm, git, etc.) here.
You must end with exactly one git commit on the current branch.

<gap-begin>
title: {{gap_title}}
slug: {{gap_slug}}
category: {{gap_category}}
body: {{gap_body}}
suggested approach: {{suggested_approach}}
expected files to change: {{expected_files_changed}}
<gap-end>

<vision-begin>
{{vision_md}}
<vision-end>

<retry-hints-begin>
{{retry_hints}}
<retry-hints-end>

Instructions:
1. Read enough of the codebase to understand context.
2. Implement the gap. Stay narrowly within scope.
3. Run any relevant tests / typecheck. Fix what you broke.
4. Create exactly ONE commit using:
     git add <only the files you intentionally changed>
     git commit -m "<conventional-commits: type(scope): subject>" -m "<body explaining why>"
5. After committing, output JSON only:

{
  "files_changed": ["<path>", "..."],
  "commands_run": ["<command>", "..."],
  "test_output_excerpt": "<last ~30 lines of test/build stdout, or empty>",
  "commit_sha": "<full sha from git rev-parse HEAD>",
  "residual_risks": ["<bullet>", "..."],
  "confidence": <float 0..1>
}

Rules:
- DO NOT touch .d2p/, .d2p-worktrees/, .git/hooks/
- DO NOT git push, git reset --hard, git rebase, or alter remote refs
- DO NOT install new dependencies unless the gap clearly needs them
- conventional-commits types: feat|fix|chore|docs|test|refactor|perf
- residual_risks: be honest about edge cases`,

  alignment: String.raw`You score how well a code change matches the stated gap. Fast scan, no deep audit.

<gap-begin>
title: {{gap_title}}
body: {{gap_body}}
suggested approach: {{suggested_approach}}
<gap-end>

<diff-begin>
{{diff_summary}}
<diff-end>

Output JSON only:
{
  "alignment": <float 0..1>,
  "addresses_gap": true|false,
  "scope_creep": true|false,
  "concerns": ["<one-line>", "..."]
}

Rules:
- alignment >= 0.7 means proceed; < 0.7 means RETRY_WITH_HINTS
- addresses_gap: did the diff actually do the thing the gap asked for?
- scope_creep: did it touch unrelated files / add unrelated features?
- concerns: brief bullets, no prose`,

  behavioral: String.raw`You are an independent code reviewer. You have not seen the implementer's reasoning.
Audit this change against the gap and the project vision.

<gap-begin>
title: {{gap_title}}
slug: {{gap_slug}}
category: {{gap_category}}
body: {{gap_body}}
suggested approach: {{suggested_approach}}
<gap-end>

<vision-begin>
{{vision_md}}
<vision-end>

<diff-begin>
{{full_diff}}
<diff-end>

<static-gate-output-begin>
{{static_gate_output}}
<static-gate-output-end>

<implementer-residuals-begin>
{{implementer_residuals}}
<implementer-residuals-end>

Output JSON only:
{
  "verdict": "APPROVE|RETRY_WITH_HINTS|ROLLBACK|ESCALATE",
  "confidence": <float 0..1>,
  "reason_code": "OK|DIVERGES_FROM_GAP|BUGGY|INCOMPLETE|OVER_SCOPED|ARCHITECTURAL|SCOPE_TOO_LARGE|TOO_HARD",
  "rationale": "<one paragraph>",
  "hints": ["<actionable line>", "..."],
  "split_into": null,
  "difficulty": <1..5>
}

Decision rules:
- APPROVE: gap clearly addressed, no obvious bugs, scope tight, tests pass.
- RETRY_WITH_HINTS: implementation is wrong/incomplete BUT a clear fix path exists.
- ROLLBACK: implementation is harmful or fundamentally broken.
- ESCALATE: implementation is beyond AI scope right now.

reason_code mapping:
- OK -> APPROVE
- DIVERGES_FROM_GAP / BUGGY / INCOMPLETE -> RETRY_WITH_HINTS or ROLLBACK
- OVER_SCOPED -> RETRY_WITH_HINTS (hints must include "remove these unrelated changes")
- ARCHITECTURAL -> ESCALATE (loop will pause for user)
- SCOPE_TOO_LARGE -> ESCALATE, MUST fill split_into with 2-4 child gaps
- TOO_HARD -> ESCALATE, gap will be marked NEED_HUMAN

difficulty (1-5): used for retry budget. 1=trivial, 5=major refactor.

If verdict=ESCALATE AND reason_code=SCOPE_TOO_LARGE, populate split_into:
[{"slug": "<kebab>", "title": "<one sentence>", "body": "<2-3 sentences>"}, ...]
Otherwise split_into=null.

Be strict: a half-working fix is RETRY, not APPROVE.`,

  adversarial: String.raw`You are a security/QA adversary. Your goal: find an input or scenario that breaks this fix.

<gap-begin>
title: {{gap_title}}
category: {{gap_category}}
body: {{gap_body}}
<gap-end>

<diff-begin>
{{full_diff}}
<diff-end>

<static-gate-output-begin>
{{static_gate_output}}
<static-gate-output-end>

Step 1: List 3 attack vectors (specific to this fix, not generic).
Step 2: For each vector, describe a concrete scenario / input that would exercise it.
Step 3: Decide whether the fix as-written would survive each scenario.

Output JSON only:
{
  "attempts": [
    {
      "vector": "<one sentence>",
      "scenario": "<concrete input or sequence>",
      "broke": true|false,
      "evidence": "<one paragraph reasoning citing diff lines>"
    }
  ],
  "any_break": true|false
}

Rules:
- Be specific. Generic attacks don't count unless this diff actually has the surface.
- broke=true only if you can point to specific diff lines that would fail.`,

  'done-check': String.raw`You judge whether a product vision has been substantially satisfied by the current state of a repository.

<vision-begin>
{{vision_md}}
<vision-end>

<preset-status-begin>
{{preset_status_summary}}
<preset-status-end>

<done-gaps-begin>
{{done_gap_summary}}
<done-gaps-end>

<repo-summary-begin>
{{repo_summary_compact}}
<repo-summary-end>

Output JSON only:
{
  "vision_satisfied": true|false,
  "rationale": "<one paragraph>",
  "remaining_themes": [
    {"theme": "<short>", "why_missing": "<one sentence>", "suggested_gap_slug": "<kebab>"}
  ]
}

Rules:
- "satisfied" means: a reasonable user reading the vision and looking at the repo would say "yes, this delivers".
- Don't be a perfectionist; "polished and complete" is fine even if some nice-to-haves remain.
- remaining_themes: list ONLY themes from the vision NOT yet substantially addressed.
- If remaining_themes non-empty, vision_satisfied=false.`,

  'repo-summary': String.raw`You summarize a repository for downstream agents in compact JSON.

<tree-begin>
{{tree_dump}}
<tree-end>

<files-begin>
{{file_heads}}
<files-end>

Output JSON only:
{
  "entry_points": ["<path>", "..."],
  "frameworks": ["<name>", "..."],
  "test_present": true|false,
  "auth_present": true|false,
  "db_present": "sqlite|postgres|mysql|in-memory|none|unknown",
  "deploy_config_present": true|false,
  "ci_present": true|false,
  "license_present": true|false,
  "readme_quality": "rich|minimal|none",
  "notable_deps": ["<dep>", "..."]
}`,
};

export const REQUIRED_PLACEHOLDERS: Record<ClaudeRole, string[]> = {
  detector: ['tree_dump', 'manifests', 'readme_head'],
  vision: ['detected_type', 'tree_short', 'drafts_so_far', 'round_index'],
  differ: ['vision_md', 'preset_md', 'preset_overrides', 'repo_summary', 'done_gap_history'],
  implementer: [
    'worktree_path',
    'gap_title',
    'gap_slug',
    'gap_category',
    'gap_body',
    'suggested_approach',
    'expected_files_changed',
    'vision_md',
    'retry_hints',
  ],
  alignment: ['gap_title', 'gap_body', 'suggested_approach', 'diff_summary'],
  behavioral: [
    'gap_title',
    'gap_slug',
    'gap_category',
    'gap_body',
    'suggested_approach',
    'vision_md',
    'full_diff',
    'static_gate_output',
    'implementer_residuals',
  ],
  adversarial: ['gap_title', 'gap_category', 'gap_body', 'full_diff', 'static_gate_output'],
  'done-check': [
    'vision_md',
    'preset_status_summary',
    'done_gap_summary',
    'repo_summary_compact',
  ],
  'repo-summary': ['tree_dump', 'file_heads'],
};

export const FORBIDDEN_SUBSTRINGS: readonly string[] = [
  '<vision-end>',
  '<tree-end>',
  '<diff-end>',
  '<gap-end>',
  '<preset-end>',
  '<manifests-end>',
  '<readme-end>',
  '<drafts-end>',
  '<files-end>',
  '<history-end>',
  '<retry-hints-end>',
  '<static-gate-output-end>',
  '<implementer-residuals-end>',
  '<repo-summary-end>',
  '<preset-overrides-end>',
  '<preset-status-end>',
  '<done-gaps-end>',
];
