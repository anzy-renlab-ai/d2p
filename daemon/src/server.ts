import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { sessionRoutes } from './routes/session.js';
import { logRoutes } from './routes/log.js';
import { healthRoutes } from './routes/health.js';

const app = new Hono();

app.use(
  '/api/*',
  cors({
    origin: process.env.D2P_UI_ORIGIN ?? 'http://localhost:5173',
    credentials: false,
  }),
);

app.route('/api/session', sessionRoutes);
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

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[d2p daemon] listening on http://localhost:${info.port}`);
});

function shutdown(sig: NodeJS.Signals) {
  console.log(`[d2p daemon] received ${sig}, exiting`);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
