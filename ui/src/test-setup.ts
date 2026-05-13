import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Clean DOM between tests — vitest with globals:false doesn't auto-cleanup.
afterEach(() => cleanup());

// EventSource isn't in jsdom; stub it so bootstrap() doesn't crash in tests.
class FakeEventSource {
  url: string;
  readyState = 0;
  addEventListener(): void { /* noop */ }
  removeEventListener(): void { /* noop */ }
  close(): void { /* noop */ }
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(url: string) { this.url = url; }
}
(globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource;
