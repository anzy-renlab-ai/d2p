/**
 * Core-paths routes:
 *   GET  /api/core-paths       — return configured globs + source
 *   POST /api/core-paths/check — check changed paths against configured globs
 */

import { Hono } from 'hono';
import { queries } from './session.js';
import { loadCorePaths } from '../core-paths/loader.js';
import { checkChangedFiles } from '../core-paths/checker.js';

export const corePathsRoutes = new Hono();

corePathsRoutes.get('/', (c) => {
  const session = queries.getCurrentActiveSession() ?? queries.getLatestSession();
  if (!session) {
    return c.json({ globs: [], source: 'none' });
  }

  const demo = queries.getDemo(session.demoId);
  if (!demo) {
    return c.json({ globs: [], source: 'none' });
  }

  const result = loadCorePaths(demo.path);
  return c.json(result);
});

corePathsRoutes.post('/check', async (c) => {
  let body: { changedPaths?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json(
      { type: 'about:blank', title: 'invalid json', status: 400, code: 'BAD_REQUEST' },
      400,
    );
  }

  if (!Array.isArray(body.changedPaths)) {
    return c.json(
      { type: 'about:blank', title: 'changedPaths must be an array', status: 400, code: 'BAD_REQUEST' },
      400,
    );
  }

  const changedPaths = (body.changedPaths as unknown[]).filter(
    (p): p is string => typeof p === 'string',
  );

  const session = queries.getCurrentActiveSession() ?? queries.getLatestSession();
  if (!session) {
    return c.json({ hits: [], matchedGlob: {} });
  }

  const demo = queries.getDemo(session.demoId);
  if (!demo) {
    return c.json({ hits: [], matchedGlob: {} });
  }

  const { globs } = loadCorePaths(demo.path);
  const result = checkChangedFiles(changedPaths, globs);
  return c.json(result);
});
