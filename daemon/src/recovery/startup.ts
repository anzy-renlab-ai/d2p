import type Database from 'better-sqlite3';
import type { Queries } from '../storage/queries.js';
import { sseHub } from '../log/sse.js';
import { git } from '../subproc/git.js';

/**
 * Mark any "in-flight" sessions/fixes as recovered after an unclean shutdown.
 *
 * Rationale: if the daemon crashed mid-loop, fixes can be left in
 * IMPLEMENTING / *_RUNNING and sessions can be left in LOOPING. On next start
 * we want to: drop the half-finished fix attempts (and their worktrees), and
 * move LOOPING sessions to PAUSED so the user can decide whether to resume.
 */
export async function runCrashRecovery(deps: { queries: Queries; db: Database.Database }): Promise<void> {
  const { queries: q, db } = deps;

  interface FixRow {
    id: number;
    gap_id: number;
    worktree_path: string;
    status: string;
  }

  const halfDone = db
    .prepare(
      `SELECT id, gap_id, worktree_path, status FROM fixes
       WHERE status IN (
         'STARTED','IMPLEMENTING','STATIC_GATE_RUNNING','ALIGNMENT_RUNNING',
         'BEHAVIORAL_RUNNING','ADVERSARIAL_RUNNING'
       )`,
    )
    .all() as FixRow[];

  for (const f of halfDone) {
    // Mark as DROPPED via direct UPDATE (bypass transition table — recovery
    // path is allowed to short-circuit).
    db.prepare(
      `UPDATE fixes SET status = 'DROPPED', finished_at = ?, stderr_excerpt = ? WHERE id = ?`,
    ).run(Date.now(), `daemon crash; auto-recovered from ${f.status}`, f.id);

    // Best-effort: clean up the worktree. We don't know the repoPath without
    // joining gaps→sessions→demos; the worktree directory itself is the path
    // we stored. `git worktree remove <path>` requires the parent repo;
    // attempt by running git from the worktree directory itself (works if the
    // worktree still has .git pointer).
    try {
      await git(['worktree', 'remove', '--force', f.worktree_path], f.worktree_path);
    } catch {
      // best-effort
    }
  }

  // Move any half-LOOPING session to PAUSED so resume requires user action.
  interface SessionRow {
    id: number;
    status: string;
  }
  const looping = db
    .prepare(`SELECT id, status FROM sessions WHERE status = 'LOOPING'`)
    .all() as SessionRow[];

  for (const s of looping) {
    db.prepare(`UPDATE sessions SET status = 'PAUSED' WHERE id = ?`).run(s.id);
    const event = q.insertLogEvent(s.id, 'warn', 'SESSION_CRASH_RECOVERED', {
      prevStatus: s.status,
      recoveredFixes: halfDone.length,
    });
    sseHub.publish({
      id: event.id,
      ts: event.ts,
      kind: 'SESSION_CRASH_RECOVERED',
      level: 'warn',
      payload: event.payload,
    });
  }

  if (halfDone.length || looping.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[d2p daemon] crash recovery: dropped ${halfDone.length} in-flight fixes, paused ${looping.length} sessions`,
    );
  }
}
