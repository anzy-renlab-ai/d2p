/**
 * Risk routes:
 *   POST /api/commits/:sha/risk/score  — compute + persist risk for a commit
 *   GET  /api/commits/:sha/risk        — read persisted risk (404 if missing)
 */

import { Hono } from 'hono';
import { queries } from './session.js';
import { parseDiff } from '../git/diff.js';
import { scoreCommit } from '../risk/score.js';
import { loadCorePaths } from '../core-paths/loader.js';

export const riskRoutes = new Hono();

riskRoutes.post('/:sha/risk/score', async (c) => {
  const { sha } = c.req.param();

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
    const { globs } = loadCorePaths(demo.path);
    const risk = scoreCommit(files, { corePaths: globs });
    queries.setCommitRisk(sha, risk);
    return c.json(risk);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json(
      { type: 'about:blank', title: 'score failed', status: 500, code: 'SCORE_FAILED', detail: message },
      500,
    );
  }
});

riskRoutes.get('/:sha/risk', (c) => {
  const { sha } = c.req.param();

  if (!/^[0-9a-f]{4,64}$/i.test(sha)) {
    return c.json(
      { type: 'about:blank', title: 'invalid sha', status: 400, code: 'BAD_REQUEST' },
      400,
    );
  }

  const risk = queries.getCommitRisk(sha);
  if (!risk) {
    return c.json(
      { type: 'about:blank', title: 'risk not scored yet', status: 404, code: 'NOT_FOUND' },
      404,
    );
  }

  return c.json(risk);
});
