// Fixture: all tests pass.
// Excluded from main vitest run via cli/vitest.config.ts (__fixtures__ glob).
// Used by vitest-orchestrator.test.ts to drive a real `npx vitest` subprocess.
import { test, expect } from 'vitest';

test('addition works', () => {
  expect(1 + 1).toBe(2);
});

test('string concatenation works', () => {
  expect('foo' + 'bar').toBe('foobar');
});
