import { Hono } from 'hono';
import { queries } from './session.js';
import { parseDiff } from '../git/diff.js';

export const commitsRoutes = new Hono();

/**
 * GET /api/commits?limit=N
 *
 * Returns merged commits for the current active (or latest) session.
 * Default limit = 50, max = 200.
 *
 * Response: { commits: MergedCommitRow[] }
 */
commitsRoutes.get('/', (c) => {
  const session = queries.getCurrentActiveSession() ?? queries.getLatestSession();
  if (!session) {
    return c.json({ commits: [] });
  }

  const rawLimit = c.req.query('limit');
  const limit = rawLimit ? Math.min(Math.max(1, parseInt(rawLimit, 10) || 50), 200) : 50;

  const commits = queries.listMergedCommits(session.id, limit);
  return c.json({ commits });
});

/**
 * GET /api/commits/:sha/diff
 *
 * Returns structured diff for a specific commit sha (compares sha~1..sha).
 * Uses the demo repo of the current active session.
 *
 * Response: { files: FileDiff[] }
 */
commitsRoutes.get('/:sha/diff', async (c) => {
  const { sha } = c.req.param();

  // Validate SHA is hex-only to avoid shell injection
  if (!/^[0-9a-f]{4,64}$/i.test(sha)) {
    return c.json(
      { type: 'about:blank', title: 'invalid sha', status: 400, code: 'BAD_REQUEST' },
      400,
    );
  }

  const session = queries.getCurrentActiveSession() ?? queries.getLatestSession();
  if (!session) {
    return c.json(
      { type: 'about:blank', title: 'no active session', status: 404, code: 'NOT_FOUND' },
      404,
    );
  }

  const demo = queries.getDemo(session.demoId);
  if (!demo) {
    return c.json(
      { type: 'about:blank', title: 'demo not found', status: 404, code: 'NOT_FOUND' },
      404,
    );
  }

  try {
    const files = await parseDiff(demo.path, `${sha}~1`, sha);
    return c.json({ files });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json(
      { type: 'about:blank', title: 'diff failed', status: 500, code: 'DIFF_FAILED', detail: message },
      500,
    );
  }
});
