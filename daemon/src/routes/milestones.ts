/**
 * Milestones routes:
 *   GET   /api/milestones      — list milestones for current session
 *   POST  /api/milestones      — create a new milestone
 *   PATCH /api/milestones/:id  — update status / completed_at
 */

import { Hono } from 'hono';
import { queries } from './session.js';
import type { MilestoneStatus } from '../types.js';

export const milestonesRoutes = new Hono();

milestonesRoutes.get('/', (c) => {
  const session = queries.getCurrentActiveSession() ?? queries.getLatestSession();
  if (!session) {
    return c.json({ milestones: [] });
  }
  const milestones = queries.listMilestones(session.id);
  return c.json({ milestones });
});

milestonesRoutes.post('/', async (c) => {
  const session = queries.getCurrentActiveSession() ?? queries.getLatestSession();
  if (!session) {
    return c.json(
      { type: 'about:blank', title: 'no active session', status: 404, code: 'NOT_FOUND' },
      404,
    );
  }

  let body: {
    title?: unknown;
    visionExcerpt?: unknown;
    presetItemIds?: unknown;
    status?: unknown;
    ordinal?: unknown;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json(
      { type: 'about:blank', title: 'invalid json', status: 400, code: 'BAD_REQUEST' },
      400,
    );
  }

  if (!body.title || typeof body.title !== 'string') {
    return c.json(
      { type: 'about:blank', title: 'title required', status: 400, code: 'BAD_REQUEST' },
      400,
    );
  }

  const milestone = queries.upsertMilestone({
    sessionId: session.id,
    title: body.title,
    visionExcerpt: typeof body.visionExcerpt === 'string' ? body.visionExcerpt : null,
    presetItemIds: Array.isArray(body.presetItemIds) ? (body.presetItemIds as string[]) : [],
    status: isValidStatus(body.status) ? body.status : 'pending',
    ordinal: typeof body.ordinal === 'number' ? body.ordinal : 0,
  });

  return c.json(milestone, 201);
});

milestonesRoutes.patch('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) {
    return c.json(
      { type: 'about:blank', title: 'invalid id', status: 400, code: 'BAD_REQUEST' },
      400,
    );
  }

  let body: { status?: unknown; completedAt?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json(
      { type: 'about:blank', title: 'invalid json', status: 400, code: 'BAD_REQUEST' },
      400,
    );
  }

  const existing = queries.getMilestone(id);
  if (!existing) {
    return c.json(
      { type: 'about:blank', title: 'milestone not found', status: 404, code: 'NOT_FOUND' },
      404,
    );
  }

  const updated = queries.upsertMilestone({
    id,
    sessionId: existing.sessionId,
    title: existing.title,
    status: isValidStatus(body.status) ? body.status : existing.status,
    completedAt:
      body.completedAt !== undefined
        ? typeof body.completedAt === 'number'
          ? body.completedAt
          : null
        : existing.completedAt,
  });

  return c.json(updated);
});

function isValidStatus(s: unknown): s is MilestoneStatus {
  return s === 'pending' || s === 'in_progress' || s === 'done';
}
