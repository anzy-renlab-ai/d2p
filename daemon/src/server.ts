import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { sessionRoutes, queries, dbHandle } from './routes/session.js';
import { logRoutes } from './routes/log.js';
import { healthRoutes } from './routes/health.js';
import { visionRoutes } from './routes/vision.js';
import { detectorRoutes } from './routes/detector.js';
import { presetRoutes } from './routes/preset.js';
import { loopRoutes } from './routes/loop.js';
import { gapRoutes } from './routes/gaps.js';
import { inputRoutes } from './routes/inputs.js';
import { deployRoutes } from './routes/deploy.js';
import { configRoutes } from './routes/config.js';
import { githubRoutes } from './routes/github.js';
import { runCrashRecovery } from './recovery/startup.js';
import { loadConfig } from './config/load.js';
import { setActiveEngine } from './engines/registry.js';

const app = new Hono();

app.use(
  '/api/*',
  cors({
    origin: process.env.D2P_UI_ORIGIN ?? 'http://localhost:5173',
    credentials: false,
  }),
);

app.route('/api/session', sessionRoutes);
app.route('/api/vision', visionRoutes);
app.route('/api/detector', detectorRoutes);
app.route('/api/preset', presetRoutes);
app.route('/api/loop', loopRoutes);
app.route('/api/gaps', gapRoutes);
app.route('/api/inputs', inputRoutes);
app.route('/api/deploy', deployRoutes);
app.route('/api/config', configRoutes);
app.route('/api/github', githubRoutes);
app.route('/api/log', logRoutes);
app.route('/api', healthRoutes);

app.onError((err, c) => {
  console.error('[d2p daemon] unhandled error:', err);
  return c.json(
    { type: 'about:blank', title: 'internal error', status: 500, code: 'INTERNAL', detail: err.message },
    500,
  );
});

const port = Number(process.env.D2P_DAEMON_PORT ?? 5174);

// Crash recovery before accepting traffic. Fire-and-forget; recovery happens
// in the background and is logged. We don't await here so the server doesn't
// block startup on git operations that may take a few hundred ms.
loadConfig()
  .then((cfg) => {
    setActiveEngine(cfg.engine);
    // eslint-disable-next-line no-console
    console.log(`[d2p daemon] engine = ${cfg.engine.kind}`);
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[d2p daemon] config load failed; using default claude-cli engine:', e);
  });

runCrashRecovery({ queries, db: dbHandle }).catch((e) => {
  // eslint-disable-next-line no-console
  console.warn('[d2p daemon] crash recovery failed:', e);
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[d2p daemon] listening on http://localhost:${info.port}`);
});

function shutdown(sig: NodeJS.Signals) {
  console.log(`[d2p daemon] received ${sig}, exiting`);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
