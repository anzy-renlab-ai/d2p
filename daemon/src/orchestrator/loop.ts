import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Queries } from '../storage/queries.js';
import {
  HIGH_SENSITIVITY_CATEGORIES,
  type Gap,
  type Session,
} from '../types.js';
import { emit, loopController } from './controller.js';
import {
  createFixWorktree,
  diffAgainstMain,
  dropFix,
  ensureRepo,
  mergeFix,
  MergeConflictError,
} from '../git/worktree.js';
import { readCheckCommands, runStaticGate, type CheckCommands } from '../static-gate/check.js';
import { runDiffer } from '../agents/differ.js';
import { runImplementer } from '../agents/implementer.js';
import {
  runAlignment,
  runBehavioral,
  runAdversarial,
  runCrossEngineCheck,
} from '../agents/reviewers.js';
import { runDoneCheck } from '../agents/done-check.js';
import { runRepoSummary, repoSummaryToText } from '../agents/repo-summary.js';
import { readPreset, readOverrides, applyOverridesToStatus } from '../preset/loader.js';
import { stringify as yamlStringify } from 'yaml';
import { startWatching, stopWatching, consumeDirty } from '../watcher/vision-watcher.js';
import { GitHubClient, parseGitHubRemote } from '../github/client.js';
import { pushFixBranch, readOriginUrl } from '../git/push.js';
import { loadConfig } from '../config/load.js';
import type { Gap as GapType } from '../types.js';

// MAX_ITERATIONS is a catastrophic safety net only — the loop is intended
// (per ABCD #D, "持续陪跑无硬终点") to keep going until either (a) preset +
// vision dual-green, (b) the user pauses, or (c) the differ stops producing
// new actionable gaps. We do NOT cap differ passes — instead we detect
// stuck loops (no new slugs across consecutive empty-differ rounds) and
// pause for the user to decide.
const MAX_ITERATIONS = 500;
const STUCK_THRESHOLD = 2; // empty-differ rounds in a row → pause

export interface LoopDeps {
  queries: Queries;
  inferredChecks?: CheckCommands;
}

interface LoopCtx {
  q: Queries;
  session: Session;
  demoPath: string;
  visionMd: string;
  inferredChecks: CheckCommands;
}

async function loadVisionMd(session: Session, demoPath: string): Promise<string> {
  const visionPath = session.visionMdPath ?? (path.join(demoPath, '.d2p', 'vision.md') as Session['visionMdPath']);
  if (!visionPath) return '';
  try {
    return await readFile(visionPath as unknown as string, 'utf8');
  } catch {
    return '';
  }
}

async function writeVisionMd(demoPath: string, body: string): Promise<string> {
  const dir = path.join(demoPath, '.d2p');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'vision.md');
  await writeFile(file, body, 'utf8');
  return file;
}

export async function finalizeVisionFile(
  q: Queries,
  session: Session,
  demoPath: string,
  body: string,
): Promise<string> {
  const file = await writeVisionMd(demoPath, body);
  q.setSessionVision(session.id, file);
  emit(q, session.id, 'VISION_FINALIZED', { path: file });
  return file;
}

function pickK(difficulty: number): number {
  if (difficulty <= 1) return 1;
  if (difficulty <= 3) return 2;
  return 3;
}

function presetStatusSummary(items: { item: string; status: string }[]): string {
  return items.map((i) => `- ${i.item}: ${i.status}`).join('\n');
}

function historyText(rows: { slug: string; title: string; status: string }[]): string {
  if (rows.length === 0) return '(no closed gaps yet)';
  return rows.map((r) => `- ${r.slug} [${r.status}]: ${r.title}`).join('\n');
}

async function runDifferAndPersist(ctx: LoopCtx): Promise<{ inserted: number; stuck: boolean }> {
  const { q, session, demoPath } = ctx;
  const presetType = session.presetType ?? 'unknown';
  const preset = await readPreset(presetType);
  const overrides = await readOverrides(demoPath);
  const summary = await runRepoSummary(q, session.id, demoPath);
  const summaryText = 'error' in summary ? `(summary error: ${summary.error})` : repoSummaryToText(summary);

  const history = q.doneGapHistory(session.id);

  const out = await runDiffer(q, session.id, {
    visionMd: ctx.visionMd,
    presetMd: preset.raw,
    presetOverridesYaml: yamlStringify(overrides),
    repoSummary: summaryText,
    doneGapHistory: historyText(history),
  });

  if ('error' in out) {
    emit(q, session.id, 'ERROR', { phase: 'differ', message: out.error }, 'error');
    return { inserted: 0, stuck: true };
  }

  // apply overrides to preset_status, persist
  const adjustedStatus = applyOverridesToStatus(out.presetStatus, overrides);
  q.setPresetStatus(session.id, adjustedStatus);

  // skip slugs already DONE/SKIPPED/NEED_HUMAN/SPLIT_DONE in this session
  const seen = new Set(history.map((h) => h.slug));
  // also skip slugs that already exist as PENDING/IN_PROGRESS
  const pending = q.listGaps(session.id, ['PENDING', 'IN_PROGRESS']);
  for (const g of pending) seen.add(g.slug);

  let inserted = 0;
  for (const g of out.gaps) {
    if (seen.has(g.slug)) continue;
    if (overrides.remove.includes(g.slug)) continue;
    q.insertGap({
      sessionId: session.id,
      slug: g.slug,
      title: g.title,
      body: g.body,
      category: g.category,
      severity: g.severity,
      source: g.source,
      suggestedApproach: g.suggestedApproach,
      expectedFilesChanged: g.expectedFilesChanged,
      parentGapId: null,
    });
    inserted++;
  }
  for (const add of overrides.add) {
    if (seen.has(add.slug)) continue;
    q.insertGap({
      sessionId: session.id,
      slug: add.slug,
      title: add.description,
      body: add.description,
      category: add.category,
      severity: add.severity,
      source: 'preset',
      suggestedApproach: '',
      expectedFilesChanged: [],
      parentGapId: null,
    });
    inserted++;
  }

  emit(q, session.id, 'DIFF_PRODUCED', { inserted, totalReturned: out.gaps.length });
  return { inserted, stuck: inserted === 0 };
}

async function processGap(ctx: LoopCtx, gap: Gap): Promise<void> {
  const { q, session, demoPath, visionMd } = ctx;
  q.transitionGap(gap.id, 'IN_PROGRESS');
  emit(q, session.id, 'GAP_PICKED', { gapId: gap.id, slug: gap.slug, severity: gap.severity });

  let retryHints: string[] = [];
  let kBudget = gap.dynamicK ?? 1; // initial; gets bumped after first behavioral

  let attempt = q.nextAttemptNumber(gap.id);
  for (; attempt <= MAX_ITERATIONS; attempt++) {
    if (loopController.pauseRequested()) {
      emit(q, session.id, 'LOOP_PAUSED', { reason: 'user_request_mid_gap' });
      return;
    }

    const wt = await createFixWorktree(demoPath, gap.slug);
    emit(q, session.id, 'WORKTREE_CREATED', { worktree: wt, attempt });

    const fix = q.insertFix({
      gapId: gap.id,
      attempt,
      branch: `fix/${gap.slug}`,
      worktreePath: wt,
    });

    // ─── Implementer ─────────────────────────────────────────────────
    q.transitionFix(fix.id, 'IMPLEMENTING');
    const impl = await runImplementer(q, session.id, fix.id, {
      gap,
      visionMd,
      worktreePath: wt,
      retryHints,
    });
    if ('error' in impl) {
      q.transitionFix(fix.id, 'DROPPED', { stderrExcerpt: impl.error });
      await dropFix(demoPath, gap.slug);
      emit(q, session.id, 'FIX_DROPPED', { reason: impl.error, phase: 'implementer' }, 'error');
      retryHints = [`Implementer failed: ${impl.error}`];
      if (attempt >= kBudget) {
        q.transitionGap(gap.id, 'NEED_HUMAN');
        emit(q, session.id, 'GAP_ESCALATED', { reason: 'IMPLEMENTER_FAILURES', kBudget });
        return;
      }
      continue;
    }

    q.transitionFix(fix.id, 'STATIC_GATE_RUNNING', {
      commitSha: impl.commitSha,
      filesChanged: impl.filesChanged,
      confidence: impl.confidence,
    });
    emit(q, session.id, 'FIX_COMMITTED', {
      fixId: fix.id,
      commitSha: impl.commitSha,
      filesChanged: impl.filesChanged,
    });

    // ─── Static gate ─────────────────────────────────────────────────
    const gate = await runStaticGate(wt, ctx.inferredChecks);
    if (!gate.passed) {
      q.transitionFix(fix.id, 'STATIC_GATE_FAILED', {
        staticGatePassed: false,
        stderrExcerpt: gate.excerpt,
      });
      q.transitionFix(fix.id, 'DROPPED');
      await dropFix(demoPath, gap.slug);
      emit(q, session.id, 'STATIC_GATE_FAILED', { stage: gate.failedStage, excerpt: gate.excerpt }, 'warn');
      retryHints = [`Static gate failed (${gate.failedStage}):\n${gate.excerpt}`];
      if (attempt >= kBudget) {
        q.transitionGap(gap.id, 'NEED_HUMAN');
        emit(q, session.id, 'GAP_ESCALATED', { reason: 'STATIC_GATE', kBudget });
        return;
      }
      continue;
    }
    q.transitionFix(fix.id, 'ALIGNMENT_RUNNING', { staticGatePassed: true });
    emit(q, session.id, 'STATIC_GATE_PASSED', { stage: gate.failedStage });

    // ─── Alignment probe ─────────────────────────────────────────────
    const fullDiff = await diffAgainstMain(wt);
    const align = await runAlignment(q, session.id, fix.id, gap, fullDiff);
    if ('error' in align) {
      q.transitionFix(fix.id, 'ALIGNMENT_FAILED');
      q.transitionFix(fix.id, 'DROPPED');
      await dropFix(demoPath, gap.slug);
      retryHints = [`Alignment probe error: ${align.error}`];
      if (attempt >= kBudget) {
        q.transitionGap(gap.id, 'NEED_HUMAN');
        emit(q, session.id, 'GAP_ESCALATED', { reason: 'ALIGNMENT_FAILURES' });
        return;
      }
      continue;
    }
    q.insertReview({
      fixId: fix.id,
      kind: 'alignment',
      model: 'haiku',
      verdict: null,
      hints: align.concerns,
      reasonCode: null,
      difficulty: null,
      splitInto: null,
      rawJson: JSON.stringify(align),
    });
    emit(q, session.id, 'ALIGNMENT_RESULT', {
      score: align.alignment,
      scopeCreep: align.scopeCreep,
    });

    if (align.alignment < 0.7 || align.scopeCreep) {
      q.transitionFix(fix.id, 'ALIGNMENT_FAILED', { alignmentScore: align.alignment });
      q.transitionFix(fix.id, 'DROPPED');
      await dropFix(demoPath, gap.slug);
      retryHints = align.concerns.length ? align.concerns : ['Alignment too low; tighten scope'];
      if (attempt >= kBudget) {
        q.transitionGap(gap.id, 'NEED_HUMAN');
        emit(q, session.id, 'GAP_ESCALATED', { reason: 'ALIGNMENT_LOW' });
        return;
      }
      continue;
    }
    q.transitionFix(fix.id, 'BEHAVIORAL_RUNNING', { alignmentScore: align.alignment });

    // ─── Behavioral reviewer ─────────────────────────────────────────
    const behav = await runBehavioral(q, session.id, fix.id, {
      gap,
      visionMd,
      fullDiff,
      staticGateOutput: gate.excerpt,
      implementerResiduals: impl.residualRisks.join('\n'),
    });
    if ('error' in behav) {
      q.transitionFix(fix.id, 'BEHAVIORAL_FAILED');
      q.transitionFix(fix.id, 'DROPPED');
      await dropFix(demoPath, gap.slug);
      retryHints = [`Behavioral reviewer error: ${behav.error}`];
      if (attempt >= kBudget) {
        q.transitionGap(gap.id, 'NEED_HUMAN');
        emit(q, session.id, 'GAP_ESCALATED', { reason: 'BEHAVIORAL_FAILURES' });
        return;
      }
      continue;
    }
    q.insertReview({
      fixId: fix.id,
      kind: 'behavioral',
      model: 'sonnet',
      verdict: behav.verdict,
      hints: behav.hints,
      reasonCode: behav.reasonCode,
      difficulty: behav.difficulty,
      splitInto: behav.splitInto,
      rawJson: JSON.stringify(behav),
    });
    emit(q, session.id, 'REVIEW_VERDICT', {
      verdict: behav.verdict,
      reasonCode: behav.reasonCode,
      confidence: behav.confidence,
      difficulty: behav.difficulty,
    });

    if (gap.dynamicK === null) {
      const k = pickK(behav.difficulty);
      q.setGapDynamicK(gap.id, k);
      kBudget = k;
    }

    if (behav.verdict === 'RETRY_WITH_HINTS' || behav.verdict === 'ROLLBACK') {
      q.transitionFix(fix.id, 'BEHAVIORAL_FAILED', {
        reviewerVerdict: behav.verdict,
        reasonCode: behav.reasonCode,
      });
      q.transitionFix(fix.id, 'DROPPED');
      await dropFix(demoPath, gap.slug);
      retryHints = behav.hints.length ? behav.hints : [behav.rationale];
      if (attempt >= kBudget) {
        q.transitionGap(gap.id, 'NEED_HUMAN');
        emit(q, session.id, 'GAP_ESCALATED', { reason: 'K_EXHAUSTED', kBudget, attempt });
        return;
      }
      continue;
    }

    if (behav.verdict === 'ESCALATE') {
      q.transitionFix(fix.id, 'BEHAVIORAL_FAILED', {
        reviewerVerdict: 'ESCALATE',
        reasonCode: behav.reasonCode,
      });
      q.transitionFix(fix.id, 'DROPPED');
      await dropFix(demoPath, gap.slug);
      if (behav.reasonCode === 'SCOPE_TOO_LARGE' && behav.splitInto && behav.splitInto.length > 0) {
        for (const child of behav.splitInto) {
          q.insertGap({
            sessionId: session.id,
            slug: child.slug,
            title: child.title,
            body: child.body,
            category: gap.category,
            severity: 'P2',
            source: gap.source,
            suggestedApproach: '',
            expectedFilesChanged: [],
            parentGapId: gap.id,
          });
        }
        q.transitionGap(gap.id, 'SPLIT_DONE');
        emit(q, session.id, 'GAP_ESCALATED', {
          reason: 'SCOPE_TOO_LARGE',
          childCount: behav.splitInto.length,
        });
      } else if (behav.reasonCode === 'ARCHITECTURAL') {
        loopController.requestPause();
        q.transitionGap(gap.id, 'NEED_HUMAN');
        emit(q, session.id, 'GAP_ESCALATED', { reason: 'ARCHITECTURAL', rationale: behav.rationale });
      } else {
        q.transitionGap(gap.id, 'NEED_HUMAN');
        emit(q, session.id, 'GAP_ESCALATED', { reason: behav.reasonCode });
      }
      return;
    }

    // ─── Cross-engine second pass (high-sensitivity only) ────────────
    const isHighSens =
      HIGH_SENSITIVITY_CATEGORIES.has(gap.category) || behav.confidence < 0.85;
    let finalBehav = behav;
    if (isHighSens) {
      const second = await runCrossEngineCheck(q, session.id, fix.id, {
        gap,
        visionMd,
        fullDiff,
        staticGateOutput: gate.excerpt,
        implementerResiduals: impl.residualRisks.join('\n'),
      }, behav);
      if (second && 'error' in second) {
        emit(q, session.id, 'ERROR', { phase: 'cross-engine', message: second.error }, 'warn');
      } else if (second) {
        // disagreement → forced rollback
        q.insertReview({
          fixId: fix.id,
          kind: 'behavioral',
          model: 'sonnet',
          verdict: second.verdict,
          hints: second.hints,
          reasonCode: second.reasonCode,
          difficulty: second.difficulty,
          splitInto: second.splitInto,
          rawJson: JSON.stringify(second),
        });
        emit(q, session.id, 'REVIEW_VERDICT', {
          verdict: second.verdict,
          reasonCode: second.reasonCode,
          confidence: second.confidence,
          crossEngineDisagreement: true,
        });
        finalBehav = second;
        // Treat as RETRY/ROLLBACK path
        q.transitionFix(fix.id, 'BEHAVIORAL_FAILED', {
          reviewerVerdict: second.verdict,
          reasonCode: second.reasonCode,
        });
        q.transitionFix(fix.id, 'DROPPED');
        await dropFix(demoPath, gap.slug);
        retryHints = second.hints.length ? second.hints : [second.rationale];
        if (attempt >= kBudget) {
          q.transitionGap(gap.id, 'NEED_HUMAN');
          emit(q, session.id, 'GAP_ESCALATED', {
            reason: 'CROSS_ENGINE_DISAGREEMENT',
            kBudget,
            attempt,
          });
          return;
        }
        continue;
      }
      // both reviewers agreed — fall through to adversarial
    }
    void finalBehav;
    if (isHighSens) {
      q.transitionFix(fix.id, 'ADVERSARIAL_RUNNING');
      const adv = await runAdversarial(q, session.id, fix.id, gap, fullDiff, gate.excerpt);
      if ('error' in adv) {
        q.transitionFix(fix.id, 'ADVERSARIAL_FAILED');
        q.transitionFix(fix.id, 'DROPPED');
        await dropFix(demoPath, gap.slug);
        retryHints = [`Adversarial reviewer error: ${adv.error}`];
        if (attempt >= kBudget) {
          q.transitionGap(gap.id, 'NEED_HUMAN');
          emit(q, session.id, 'GAP_ESCALATED', { reason: 'ADVERSARIAL_FAILURES' });
          return;
        }
        continue;
      }
      q.insertReview({
        fixId: fix.id,
        kind: 'adversarial',
        model: 'sonnet',
        verdict: null,
        hints: adv.attempts.filter((a) => a.broke).map((a) => a.vector),
        reasonCode: null,
        difficulty: null,
        splitInto: null,
        rawJson: JSON.stringify(adv),
      });
      emit(q, session.id, 'ADVERSARIAL_RESULT', { anyBreak: adv.anyBreak });
      if (adv.anyBreak) {
        q.transitionFix(fix.id, 'ADVERSARIAL_FAILED', {
          reviewerVerdict: 'ROLLBACK',
          reasonCode: 'BUGGY',
        });
        q.transitionFix(fix.id, 'DROPPED');
        await dropFix(demoPath, gap.slug);
        retryHints = adv.attempts.filter((a) => a.broke).map((a) => `${a.vector}: ${a.scenario}`);
        if (attempt >= kBudget) {
          q.transitionGap(gap.id, 'NEED_HUMAN');
          emit(q, session.id, 'GAP_ESCALATED', { reason: 'ADVERSARIAL_BREAK' });
          return;
        }
        continue;
      }
    }

    // ─── Merge OR Push+PR ────────────────────────────────────────────
    if (ctx.session.mode === 'github-pr') {
      try {
        const result = await pushAndOpenPR(ctx, gap, fix.id);
        if ('error' in result) throw new Error(result.error);
        q.setFixPR(fix.id, result.number, result.htmlUrl);
        q.transitionFix(fix.id, 'MERGED', { reviewerVerdict: 'APPROVE', reasonCode: 'OK' });
        q.transitionGap(gap.id, 'DONE');
        // Keep the worktree branch around since it's now tracked by a remote PR.
        emit(q, session.id, 'MERGED', {
          slug: gap.slug,
          prNumber: result.number,
          prUrl: result.htmlUrl,
          mode: 'github-pr',
        });
        emit(q, session.id, 'GAP_DONE', { slug: gap.slug, gapId: gap.id });
        return;
      } catch (e) {
        const msg = (e as Error).message;
        try {
          q.transitionFix(fix.id, 'BEHAVIORAL_FAILED', {
            reviewerVerdict: 'ROLLBACK',
            reasonCode: 'BUGGY',
            stderrExcerpt: msg,
          });
        } catch {
          // best-effort
        }
        try { q.transitionFix(fix.id, 'DROPPED'); } catch { /* best-effort */ }
        await dropFix(demoPath, gap.slug);
        q.transitionGap(gap.id, 'NEED_HUMAN');
        emit(q, session.id, 'GAP_ESCALATED', { reason: 'PR_PUSH_FAILED', message: msg }, 'warn');
        return;
      }
    }
    try {
      const merged = await mergeFix(demoPath, gap.slug, gap.title);
      q.transitionFix(fix.id, 'MERGED', { reviewerVerdict: 'APPROVE', reasonCode: 'OK' });
      q.transitionGap(gap.id, 'DONE');
      emit(q, session.id, 'MERGED', { mergeSha: merged.mergeSha, slug: gap.slug });
      emit(q, session.id, 'GAP_DONE', { slug: gap.slug, gapId: gap.id });
      return;
    } catch (e) {
      const msg = e instanceof MergeConflictError ? e.message : (e as Error).message;
      try {
        q.transitionFix(fix.id, 'BEHAVIORAL_FAILED', {
          reviewerVerdict: 'ROLLBACK',
          reasonCode: 'BUGGY',
          stderrExcerpt: msg,
        });
      } catch {
        // best-effort; status may already be elsewhere
      }
      try {
        q.transitionFix(fix.id, 'DROPPED');
      } catch {
        // best-effort
      }
      await dropFix(demoPath, gap.slug);
      q.transitionGap(gap.id, 'NEED_HUMAN');
      emit(q, session.id, 'GAP_ESCALATED', { reason: 'MERGE_CONFLICT', message: msg }, 'warn');
      return;
    }
  }
}

async function pushAndOpenPR(
  ctx: LoopCtx,
  gap: GapType,
  fixId: number,
): Promise<{ number: number; htmlUrl: string } | { error: string }> {
  const cfg = await loadConfig();
  if (!cfg.github?.token) return { error: 'GitHub token not configured (set ~/.d2p/config.json)' };
  let repoSpec = ctx.session.githubRepo;
  if (!repoSpec) {
    const origin = await readOriginUrl(ctx.demoPath);
    const parsed = origin ? parseGitHubRemote(origin) : null;
    if (!parsed) return { error: 'session.githubRepo unset and origin not a github URL' };
    repoSpec = `${parsed.owner}/${parsed.repo}`;
  }
  const [owner, repo] = repoSpec.split('/');
  if (!owner || !repo) return { error: `bad githubRepo ${repoSpec}` };

  const pushed = await pushFixBranch({
    repoPath: ctx.demoPath,
    branch: `fix/${gap.slug}`,
    token: cfg.github.token,
    owner,
    repo,
  });
  if (!pushed.ok) return { error: `push failed: ${pushed.stderr.slice(0, 300)}` };

  const gh = new GitHubClient(cfg.github.token);
  const pr = await gh.openPR({
    owner,
    repo,
    title: `fix(${gap.category}): ${gap.title}`,
    body:
      `Opened automatically by d2p.\n\n` +
      `**Gap**: \`${gap.slug}\`\n\n` +
      `${gap.body}\n\n` +
      `Severity: ${gap.severity}\n\n` +
      `_d2p session ${ctx.session.id}, fix ${fixId}_`,
    head: `fix/${gap.slug}`,
    base: ctx.session.baseBranch,
  });
  if ('error' in pr) return { error: pr.error };
  return { number: pr.number, htmlUrl: pr.htmlUrl };
}

export async function runLoop(deps: LoopDeps, sessionId: number): Promise<void> {
  const { queries: q } = deps;
  const session = q.getSession(sessionId);
  if (!session) throw new Error(`session ${sessionId} not found`);
  const demo = q.getDemo(session.demoId);
  if (!demo) throw new Error(`demo for session ${sessionId} not found`);
  const demoPath = demo.path as unknown as string;

  await ensureRepo(demoPath);

  // Transition session SETUP -> LOOPING if needed
  if (session.status === 'SETUP') {
    q.transitionSession(session.id, 'LOOPING');
  } else if (session.status === 'PAUSED') {
    q.transitionSession(session.id, 'LOOPING');
    emit(q, session.id, 'LOOP_RESUMED', {});
  }

  emit(q, session.id, 'LOOP_STARTED', {});
  startWatching(q, session.id, demoPath);

  let visionMd = await loadVisionMd(session, demoPath);
  const inferredChecks: CheckCommands = deps.inferredChecks ?? (await readCheckCommands(demoPath, {
    build: 'npm run build',
    test: 'npm test',
    typecheck: 'npx tsc --noEmit',
  }));

  const ctx: LoopCtx = {
    q,
    session: q.getSession(sessionId)!,
    demoPath,
    visionMd,
    inferredChecks,
  };

  let emptyDifferStreak = 0;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (loopController.pauseRequested()) {
      q.transitionSession(session.id, 'PAUSED');
      emit(q, session.id, 'LOOP_PAUSED', { reason: 'user_request' });
      stopWatching(session.id);
      return;
    }

    // Vision/preset edits on disk reset the stuck counter and force a re-diff.
    if (consumeDirty(session.id)) {
      emptyDifferStreak = 0;
      visionMd = await loadVisionMd(session, demoPath);
      ctx.visionMd = visionMd;
      emit(q, session.id, 'LOOP_RESUMED', { reason: 'watcher_dirty' });
    }

    const head = q.pickHeadGap(session.id);
    if (head) {
      await processGap(ctx, head);
      continue;
    }

    // No pending gap. Run differ FIRST so preset_status and gaps refresh, THEN
    // evaluate done-check against current state.
    const { inserted } = await runDifferAndPersist(ctx);
    if (inserted > 0) {
      emptyDifferStreak = 0;
      continue;
    }
    emptyDifferStreak++;

    // No new gaps from differ. Check done condition with fresh preset_status.
    const presetGreen = q.isPresetAllDone(session.id);
    const history = q.doneGapHistory(session.id);
    const presetItems = q.latestPresetStatus(session.id);

    let visionVerdict = { satisfied: false, rationale: '', remaining: 0 };
    if (visionMd) {
      const dc = await runDoneCheck(q, session.id, {
        visionMd,
        presetStatusSummary: presetStatusSummary(presetItems),
        doneGapSummary: historyText(history),
        repoSummaryCompact: '(see latest summary)',
      });
      if ('error' in dc) {
        emit(q, session.id, 'ERROR', { phase: 'done-check', message: dc.error }, 'error');
      } else {
        visionVerdict = {
          satisfied: dc.visionSatisfied,
          rationale: dc.rationale,
          remaining: dc.remainingThemes.length,
        };
        emit(q, session.id, 'DONE_CHECK_RESULT', {
          visionSatisfied: dc.visionSatisfied,
          remaining: dc.remainingThemes.length,
        });
      }
    }

    if (presetGreen && visionVerdict.satisfied) {
      q.transitionSession(session.id, 'DONE');
      emit(q, session.id, 'SESSION_DONE', { rationale: visionVerdict.rationale });
      stopWatching(session.id);
      return;
    }

    // Not done. If the differ has produced nothing new for `STUCK_THRESHOLD`
    // rounds in a row, ask the user (pause). Otherwise loop and try again —
    // a watcher event or a vision/preset change may unstick us.
    if (emptyDifferStreak >= STUCK_THRESHOLD) {
      q.transitionSession(session.id, 'PAUSED');
      emit(
        q,
        session.id,
        'LOOP_PAUSED',
        {
          reason: 'no_more_gaps_but_not_done',
          presetGreen,
          visionSatisfied: visionVerdict.satisfied,
          emptyDifferStreak,
        },
        'warn',
      );
      stopWatching(session.id);
      return;
    }
  }

  // Safety: max iterations hit
  q.transitionSession(session.id, 'PAUSED');
  emit(q, session.id, 'LOOP_PAUSED', { reason: 'max_iterations' }, 'warn');
}
