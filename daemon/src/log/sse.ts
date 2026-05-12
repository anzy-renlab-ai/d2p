import type { SseEnvelope } from '../types.js';

export type SseListener = (event: SseEnvelope) => void;

/**
 * In-process pub/sub for SSE log events. One hub per daemon instance.
 * Listeners are kept in a Set and cleaned up via the returned unsubscribe.
 */
export class SseHub {
  private listeners = new Set<SseListener>();

  subscribe(fn: SseListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  publish(event: SseEnvelope): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        // a misbehaving listener must not break others
      }
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

export const sseHub = new SseHub();
