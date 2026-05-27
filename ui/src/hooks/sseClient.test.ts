import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildStreamUrl, isLocalhostUrl, createSSEClient } from './sseClient.js';

// ── Minimal EventSource fake for these tests ──────────────────────────────
//
// test-setup.ts installs a global FakeEventSource that no-ops everything.
// For sseClient.test we want to verify the URL we actually opened and the
// addEventListener pipe-through, so we replace the global with a richer
// fake just for this file's lifetime.

interface CapturedListener {
  type: string;
  fn: (ev: Event) => void;
}

class CaptureES {
  static instances: CaptureES[] = [];
  url: string;
  readyState: 0 | 1 | 2 = 0;
  onerror: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  listeners: CapturedListener[] = [];
  closed = false;
  constructor(url: string) {
    this.url = url;
    CaptureES.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: Event) => void): void {
    this.listeners.push({ type, fn });
  }
  removeEventListener(type: string, fn: (ev: Event) => void): void {
    this.listeners = this.listeners.filter((l) => l.type !== type || l.fn !== fn);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  /** Fire a MessageEvent-shaped event for tests. */
  emit(type: string, data: string, lastEventId = ''): void {
    const ev = new MessageEvent(type, { data, lastEventId });
    for (const l of this.listeners) {
      if (l.type === type) l.fn(ev);
    }
  }
  fireError(): void {
    const ev = new Event('error');
    this.onerror?.(ev);
  }
}

describe('sseClient', () => {
  let originalES: unknown;
  beforeEach(() => {
    originalES = (globalThis as { EventSource?: unknown }).EventSource;
    (globalThis as { EventSource: unknown }).EventSource = CaptureES;
    CaptureES.instances = [];
  });
  afterEach(() => {
    (globalThis as { EventSource?: unknown }).EventSource = originalES;
  });

  describe('isLocalhostUrl', () => {
    it('accepts relative URLs (proxied paths)', () => {
      expect(isLocalhostUrl('/api/stream')).toBe(true);
      expect(isLocalhostUrl('./stream')).toBe(true);
    });
    it('accepts 127.0.0.1, localhost, ::1', () => {
      expect(isLocalhostUrl('http://127.0.0.1:5174/api/stream')).toBe(true);
      expect(isLocalhostUrl('http://localhost:5174/api/stream')).toBe(true);
      expect(isLocalhostUrl('http://[::1]:5174/api/stream')).toBe(true);
    });
    it('rejects non-loopback hosts', () => {
      expect(isLocalhostUrl('https://example.com/api/stream')).toBe(false);
      expect(isLocalhostUrl('http://10.0.0.1/api/stream')).toBe(false);
    });
  });

  describe('buildStreamUrl', () => {
    it('returns the original URL when no lastEventId provided', () => {
      expect(buildStreamUrl('/api/stream')).toBe('/api/stream');
      expect(buildStreamUrl('/api/stream', {})).toBe('/api/stream');
    });
    it('appends lastEventId query param to relative URLs as a relative URL', () => {
      const out = buildStreamUrl('/api/stream', { lastEventId: 42 });
      expect(out).toBe('/api/stream?lastEventId=42');
    });
    it('keeps existing query string and adds lastEventId', () => {
      const out = buildStreamUrl('/api/stream?foo=bar', { lastEventId: 7 });
      // searchParams may reorder — assert by parse not by string compare.
      const u = new URL(out, 'http://127.0.0.1');
      expect(u.searchParams.get('foo')).toBe('bar');
      expect(u.searchParams.get('lastEventId')).toBe('7');
    });
    it('preserves absolute URLs with origin intact', () => {
      const out = buildStreamUrl('http://127.0.0.1:5174/api/stream', { lastEventId: '99' });
      expect(out.startsWith('http://127.0.0.1:5174/api/stream')).toBe(true);
      expect(out).toContain('lastEventId=99');
    });
  });

  describe('createSSEClient', () => {
    it('opens an EventSource against the given URL', () => {
      const h = createSSEClient('/api/stream');
      expect(CaptureES.instances.length).toBe(1);
      expect(CaptureES.instances[0]!.url).toBe('/api/stream');
      expect(h.url).toBe('/api/stream');
    });

    it('passes lastEventId via ?lastEventId query param (header workaround)', () => {
      createSSEClient('/api/stream', { lastEventId: 17 });
      expect(CaptureES.instances[0]!.url).toBe('/api/stream?lastEventId=17');
    });

    it('addEventListener bridges MessageEvent to {data, lastEventId} shape', () => {
      const h = createSSEClient('/api/stream');
      const seen: Array<{ data: string; lastEventId?: string }> = [];
      h.addEventListener('branch-trace.append', (e) => seen.push(e));
      CaptureES.instances[0]!.emit('branch-trace.append', '{"seq":1}', 'id-1');
      expect(seen.length).toBe(1);
      expect(seen[0]!.data).toBe('{"seq":1}');
      expect(seen[0]!.lastEventId).toBe('id-1');
    });

    it('close() releases the underlying EventSource and flips readyState', () => {
      const h = createSSEClient('/api/stream');
      expect(CaptureES.instances[0]!.closed).toBe(false);
      h.close();
      expect(CaptureES.instances[0]!.closed).toBe(true);
      expect(h.readyState).toBe(2);
    });

    it('readyState mirrors the underlying EventSource', () => {
      const h = createSSEClient('/api/stream');
      // CaptureES starts at 0 (CONNECTING) — verify pass-through
      expect(h.readyState).toBe(0);
      CaptureES.instances[0]!.readyState = 1;
      expect(h.readyState).toBe(1);
    });

    it('onerror is wired through from the underlying EventSource', () => {
      const h = createSSEClient('/api/stream');
      const onErr = vi.fn();
      h.onerror = onErr;
      CaptureES.instances[0]!.fireError();
      expect(onErr).toHaveBeenCalledOnce();
    });

    it('refuses to connect to non-loopback URLs', () => {
      expect(() => createSSEClient('https://evil.example.com/api/stream')).toThrow(
        /non-loopback/i,
      );
      expect(CaptureES.instances.length).toBe(0);
    });

    it('throws a clear error when EventSource is unavailable', () => {
      const saved = (globalThis as { EventSource?: unknown }).EventSource;
      delete (globalThis as { EventSource?: unknown }).EventSource;
      try {
        expect(() => createSSEClient('/api/stream')).toThrow(/EventSource is not available/i);
      } finally {
        (globalThis as { EventSource?: unknown }).EventSource = saved;
      }
    });
  });
});
