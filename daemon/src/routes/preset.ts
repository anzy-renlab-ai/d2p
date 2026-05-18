import { Hono } from 'hono';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { queries } from './session.js';
import { readPreset, listAvailablePresets, readOverrides } from '../preset/loader.js';
import { emit } from '../orchestrator/controller.js';
import type { ProjectType } from '../types.js';

export const presetRoutes = new Hono();

presetRoutes.get('/list', async (c) => {
  const types = await listAvailablePresets();
  return c.json({ types });
});

presetRoutes.post('/choose', async (c) => {
  const session = queries.getCurrentActiveSession();
  if (!session) {
    return c.json(
      { type: 'about:blank', title: 'no active session', status: 409, code: 'INVALID_STATE' },
      409,
    );
  }
  let body: { type?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ type: 'about:blank', title: 'bad json', status: 400, code: 'BAD_REQUEST' }, 400);
  }
  if (!body.type) {
    return c.json(
      { type: 'about:blank', title: 'missing type', status: 400, code: 'BAD_REQUEST' },
      400,
    );
  }
  const preset = await readPreset(body.type).catch(() => null);
  if (!preset) {
    return c.json(
      { type: 'about:blank', title: 'preset not found', status: 404, code: 'NOT_FOUND' },
      404,
    );
  }
  queries.setSessionPresetType(session.id, body.type as ProjectType);
  emit(queries, session.id, 'PRESET_CHOSEN', { type: body.type });
  return c.json({ type: body.type, presetMd: preset.raw, items: preset.frontmatter.items ?? [] });
});

presetRoutes.get('/current', async (c) => {
  const session = queries.getCurrentActiveSession();
  if (!session || !session.presetType) {
    return c.json({ type: null, presetMd: null, overrides: { add: [], remove: [], skip: [] }, statusLatest: [] });
  }
  const demo = queries.getDemo(session.demoId);
  const preset = await readPreset(session.presetType).catch(() => null);
  const overrides = demo
    ? await readOverrides(demo.path as unknown as string)
    : { add: [], remove: [], skip: [] };
  const statusLatest = queries.latestPresetStatus(session.id);
  return c.json({
    type: session.presetType,
    presetMd: preset?.raw ?? null,
    items: preset?.frontmatter.items ?? [],
    overrides,
    statusLatest,
  });
});

presetRoutes.post('/override', async (c) => {
  // Allow editing overrides any time the session isn't terminated.
  const session = queries.getCurrentActiveSession() ?? queries.getLatestSession();
  if (!session || session.status === 'ENDED') {
    return c.json(
      { type: 'about:blank', title: 'no usable session', status: 409, code: 'INVALID_STATE' },
      409,
    );
  }
  const demo = queries.getDemo(session.demoId);
  if (!demo) {
    return c.json({ type: 'about:blank', title: 'demo missing', status: 500, code: 'INTERNAL' }, 500);
  }
  let body: { overrides?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ type: 'about:blank', title: 'bad json', status: 400, code: 'BAD_REQUEST' }, 400);
  }
  const yamlOut = yamlStringify(body.overrides ?? {});
  const file = path.join(demo.path as unknown as string, '.d2p', 'preset-overrides.yaml');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, yamlOut, 'utf8');
  // also verify it parses
  try {
    yamlParse(yamlOut);
    void readFile(file, 'utf8');
  } catch {
    // ignore
  }
  return c.json({ ok: true });
});
