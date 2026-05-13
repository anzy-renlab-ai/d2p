import { Hono } from 'hono';
import { loadConfig, saveConfig, defaultConfigPath, redactForView, AppConfigSchema } from '../config/load.js';
import { setActiveEngine } from '../engines/registry.js';

export const configRoutes = new Hono();

configRoutes.get('/', async (c) => {
  const cfg = await loadConfig();
  return c.json({
    config: redactForView(cfg),
    path: defaultConfigPath(),
  });
});

configRoutes.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ type: 'about:blank', title: 'bad json', status: 400, code: 'BAD_REQUEST' }, 400);
  }
  const parsed = AppConfigSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        type: 'about:blank',
        title: 'invalid config',
        status: 400,
        code: 'BAD_REQUEST',
        detail: parsed.error.message,
      },
      400,
    );
  }
  await saveConfig(parsed.data);
  setActiveEngine(parsed.data.engine);
  return c.json({ ok: true, config: redactForView(parsed.data) });
});
