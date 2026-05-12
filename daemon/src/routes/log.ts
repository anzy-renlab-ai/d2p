import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { queries } from './session.js';
import { sseHub } from '../log/sse.js';
import type { SseEnvelope } from '../types.js';

export const logRoutes = new Hono();

logRoutes.get('/stream', (c) => {
  return streamSSE(c, async (stream) => {
    const session = queries.getCurrentActiveSession();
    if (session) {
      const snapshot = queries.recentLogEvents(session.id, 100);
      for (const e of snapshot) {
        await stream.writeSSE({
          id: String(e.id),
          event: 'log',
          data: JSON.stringify({
            id: e.id,
            ts: e.ts,
            kind: e.kind,
            level: e.level,
            payload: e.payload,
          } satisfies SseEnvelope),
        });
      }
    }

    const queue: SseEnvelope[] = [];
    let waker: (() => void) | null = null;
    const unsub = sseHub.subscribe((event) => {
      queue.push(event);
      if (waker) {
        waker();
        waker = null;
      }
    });

    let closed = false;
    stream.onAbort(() => {
      closed = true;
      unsub();
      if (waker) {
        waker();
        waker = null;
      }
    });

    const heartbeat = setInterval(async () => {
      try {
        await stream.writeSSE({ event: 'heartbeat', data: JSON.stringify({ ts: Date.now() }) });
      } catch {
        closed = true;
      }
    }, 15_000);

    try {
      while (!closed) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            waker = resolve;
          });
          continue;
        }
        const event = queue.shift()!;
        await stream.writeSSE({
          id: String(event.id),
          event: 'log',
          data: JSON.stringify(event),
        });
      }
    } finally {
      clearInterval(heartbeat);
      unsub();
    }
  });
});

logRoutes.get('/events', (c) => {
  const session = queries.getCurrentActiveSession();
  if (!session) return c.json({ events: [], hasMore: false });
  const limit = Math.min(parseInt(c.req.query('limit') ?? '200', 10), 1000);
  const events = queries.recentLogEvents(session.id, limit);
  return c.json({ events, hasMore: false });
});
