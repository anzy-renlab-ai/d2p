import { Hono } from 'hono';
import { queries } from './session.js';
import { PRICING_PER_MTOK } from '../cost/pricing.js';

export const projectsRoutes = new Hono();

/**
 * GET /api/projects
 *
 * Returns the list of registered demos with their session counts and latest
 * session status. Backs ProjectsHome.
 */
projectsRoutes.get('/', (c) => {
  const projects = queries.listProjects(PRICING_PER_MTOK);
  return c.json({ projects });
});

/**
 * GET /api/projects/:id/sessions
 *
 * Returns the sessions for a given project (demo), with derived counts
 * (commitsCount, agentCalls, topRisk). Backs SessionsList.
 */
projectsRoutes.get('/:id/sessions', (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return c.json(
      { type: 'about:blank', title: 'invalid project id', status: 400, code: 'BAD_REQUEST' },
      400,
    );
  }
  const sessions = queries.listSessionsByDemo(id);
  return c.json({ sessions });
});
