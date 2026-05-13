import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import type { Queries } from '../storage/queries.js';
import type { Session, GapStatus } from '../types.js';
import { PRICING_PER_MTOK } from '../cost/pricing.js';

interface GapSummary {
  slug: string;
  title: string;
  status: GapStatus;
  attempts: number;
  category: string;
  severity: string;
  finishedAt: number | null;
}

interface ReasonRow {
  slug: string;
  reason_code: string | null;
}

export interface GenerateSummaryDeps {
  queries: Queries;
  /** Raw db handle — needed for joins not yet on Queries. */
  db: Database.Database;
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}min`;
  if (m) return `${m}min ${sec}s`;
  return `${sec}s`;
}

function fmtTs(ms: number): string {
  const d = new Date(ms);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

/** Build the human-readable session-summary.md content. */
export function renderSessionSummary(input: {
  session: Session;
  demoPath: string;
  closedGaps: GapSummary[];
  needHumanGaps: { slug: string; title: string; reason: string | null }[];
  splitGaps: { slug: string; title: string }[];
  presetType: string | null;
  presetItems: { item: string; status: 'done' | 'partial' | 'missing' }[];
  visionMd: string;
  visionVerdict: { satisfied: boolean; rationale: string } | null;
  costTotals: { inputTokens: number; outputTokens: number; estimatedUsd: number };
  mergedCommits: { slug: string; sha: string }[];
}): string {
  const {
    session,
    demoPath,
    closedGaps,
    needHumanGaps,
    splitGaps,
    presetType,
    presetItems,
    visionMd,
    visionVerdict,
    costTotals,
    mergedCommits,
  } = input;

  const totalAttempts = closedGaps.reduce((a, g) => a + g.attempts, 0);
  const duration = session.endedAt ? session.endedAt - session.startedAt : Date.now() - session.startedAt;
  const presetDone = presetItems.filter((i) => i.status === 'done').length;
  const presetMissing = presetItems.filter((i) => i.status === 'missing').length;
  const presetPartial = presetItems.filter((i) => i.status === 'partial').length;

  const lines: string[] = [];
  lines.push(`# Session Summary — ${path.basename(demoPath)}`);
  lines.push('');
  lines.push(`- Session ID: ${session.id}`);
  lines.push(`- Demo: \`${demoPath}\``);
  lines.push(`- Started: ${fmtTs(session.startedAt)}`);
  lines.push(`- Ended: ${session.endedAt ? fmtTs(session.endedAt) : '(still active)'}`);
  lines.push(`- Duration: ${fmtDuration(duration)}`);
  lines.push(`- Status: ${session.status}`);
  lines.push(`- Preset: ${presetType ?? '(none)'}`);
  lines.push('');

  lines.push(`## Stats`);
  lines.push(`- Gaps closed: ${closedGaps.filter((g) => g.status === 'DONE').length}`);
  lines.push(`- Gaps skipped: ${closedGaps.filter((g) => g.status === 'SKIPPED').length}`);
  lines.push(`- Gaps NEED_HUMAN: ${needHumanGaps.length}`);
  lines.push(`- Gaps split: ${splitGaps.length}`);
  lines.push(`- Fix attempts total: ${totalAttempts}`);
  lines.push(`- Merge commits on main: ${mergedCommits.length}`);
  lines.push(
    `- Preset progress: ${presetDone}/${presetItems.length} done, ${presetPartial} partial, ${presetMissing} missing`,
  );
  lines.push(
    `- Cost: ~$${costTotals.estimatedUsd.toFixed(2)} (input ${costTotals.inputTokens.toLocaleString()} tok / output ${costTotals.outputTokens.toLocaleString()} tok)`,
  );
  lines.push('');

  if (closedGaps.some((g) => g.status === 'DONE')) {
    lines.push(`## Closed Gaps`);
    for (const g of closedGaps) {
      if (g.status !== 'DONE') continue;
      const c = mergedCommits.find((m) => m.slug === g.slug);
      lines.push(`- ✓ ${g.slug} [${g.severity}, attempt ${g.attempts}]${c ? ` — ${c.sha.slice(0, 7)}` : ''}: ${g.title}`);
    }
    lines.push('');
  }

  const skipped = closedGaps.filter((g) => g.status === 'SKIPPED');
  if (skipped.length) {
    lines.push(`## Skipped Gaps`);
    for (const g of skipped) lines.push(`- ⏭ ${g.slug}: ${g.title}`);
    lines.push('');
  }

  if (needHumanGaps.length) {
    lines.push(`## Need Human Attention`);
    for (const g of needHumanGaps) lines.push(`- ⚠ ${g.slug}${g.reason ? ` (${g.reason})` : ''}: ${g.title}`);
    lines.push('');
  }

  if (splitGaps.length) {
    lines.push(`## Split Gaps`);
    lines.push(`(replaced by child gaps in the queue)`);
    for (const g of splitGaps) lines.push(`- ↳ ${g.slug}: ${g.title}`);
    lines.push('');
  }

  if (visionVerdict) {
    lines.push(`## Vision Verdict`);
    lines.push(`- satisfied: ${visionVerdict.satisfied}`);
    lines.push(`- rationale: ${visionVerdict.rationale}`);
    lines.push('');
  }

  lines.push(`## Vision`);
  lines.push('');
  lines.push(visionMd.trim() || '(no vision recorded)');
  lines.push('');

  return lines.join('\n');
}

export async function generateAndWriteSessionSummary(
  deps: GenerateSummaryDeps,
  sessionId: number,
): Promise<string | null> {
  const { queries, db } = deps;
  const session = queries.getSession(sessionId);
  if (!session) return null;
  const demo = queries.getDemo(session.demoId);
  if (!demo) return null;
  const demoPath = demo.path as unknown as string;

  // closed-gaps query
  interface GapRow {
    slug: string;
    title: string;
    status: GapStatus;
    category: string;
    severity: string;
    finished_at: number | null;
  }
  const gapRows = db
    .prepare(
      `SELECT slug, title, status, category, severity, finished_at FROM gaps
       WHERE session_id = ? AND status IN ('DONE','SKIPPED','NEED_HUMAN','SPLIT_DONE')
       ORDER BY finished_at ASC`,
    )
    .all(sessionId) as GapRow[];

  const closedGaps: GapSummary[] = gapRows.map((r) => {
    const a = db.prepare('SELECT COUNT(*) AS n FROM fixes WHERE gap_id = (SELECT id FROM gaps WHERE session_id = ? AND slug = ?)')
      .get(sessionId, r.slug) as { n: number };
    return {
      slug: r.slug,
      title: r.title,
      status: r.status,
      attempts: a.n,
      category: r.category,
      severity: r.severity,
      finishedAt: r.finished_at,
    };
  });

  const needHumanGaps = gapRows
    .filter((g) => g.status === 'NEED_HUMAN')
    .map((g) => {
      const lastFix = db
        .prepare(
          `SELECT reason_code FROM fixes WHERE gap_id = (SELECT id FROM gaps WHERE session_id = ? AND slug = ?)
           ORDER BY attempt DESC LIMIT 1`,
        )
        .get(sessionId, g.slug) as ReasonRow | undefined;
      return { slug: g.slug, title: g.title, reason: lastFix?.reason_code ?? null };
    });

  const splitGaps = gapRows
    .filter((g) => g.status === 'SPLIT_DONE')
    .map((g) => ({ slug: g.slug, title: g.title }));

  // merged commits via log_events MERGED
  interface MergedRow {
    payload_json: string;
  }
  const mergedRows = db
    .prepare(`SELECT payload_json FROM log_events WHERE session_id = ? AND kind = 'MERGED' ORDER BY ts ASC`)
    .all(sessionId) as MergedRow[];
  const mergedCommits = mergedRows
    .map((r) => JSON.parse(r.payload_json) as { slug?: string; mergeSha?: string })
    .filter((p) => typeof p.slug === 'string' && typeof p.mergeSha === 'string')
    .map((p) => ({ slug: p.slug as string, sha: p.mergeSha as string }));

  // done-check verdict — latest
  interface DoneCheckRow {
    payload_json: string;
  }
  const dcRow = db
    .prepare(
      `SELECT payload_json FROM log_events WHERE session_id = ? AND kind = 'DONE_CHECK_RESULT'
       ORDER BY ts DESC LIMIT 1`,
    )
    .get(sessionId) as DoneCheckRow | undefined;
  let visionVerdict: { satisfied: boolean; rationale: string } | null = null;
  if (dcRow) {
    const payload = JSON.parse(dcRow.payload_json) as { visionSatisfied?: boolean };
    visionVerdict = {
      satisfied: payload.visionSatisfied === true,
      rationale: '(see DONE_CHECK_RESULT event payload)',
    };
  }
  // SESSION_DONE rationale is more informative
  interface SessionDoneRow {
    payload_json: string;
  }
  const sdRow = db
    .prepare(`SELECT payload_json FROM log_events WHERE session_id = ? AND kind = 'SESSION_DONE' LIMIT 1`)
    .get(sessionId) as SessionDoneRow | undefined;
  if (sdRow) {
    const payload = JSON.parse(sdRow.payload_json) as { rationale?: string };
    if (visionVerdict) visionVerdict.rationale = payload.rationale ?? visionVerdict.rationale;
  }

  // vision.md
  let visionMd = '';
  if (session.visionMdPath) {
    const { readFile } = await import('node:fs/promises');
    visionMd = await readFile(session.visionMdPath as unknown as string, 'utf8').catch(() => '');
  }

  const presetItems = queries.latestPresetStatus(sessionId).map((i) => ({
    item: i.item,
    status: i.status,
  }));
  const costTotals = queries.costTotals(sessionId, PRICING_PER_MTOK);

  const body = renderSessionSummary({
    session,
    demoPath,
    closedGaps,
    needHumanGaps,
    splitGaps,
    presetType: session.presetType,
    presetItems,
    visionMd,
    visionVerdict,
    costTotals,
    mergedCommits,
  });

  const file = path.join(demoPath, '.d2p', 'session-summary.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body, 'utf8');
  return file;
}
