// Fixture: mix of pass + fail + skipped.
// Excluded from main vitest run via cli/vitest.config.ts (__fixtures__ glob).
// Used by vitest-orchestrator.test.ts to drive a real `npx vitest` subprocess.
import { test, expect } from 'vitest';

test('this passes', () => {
  expect(2 + 2).toBe(4);
});

test('this intentionally fails', () => {
  expect(1).toBe(2);
});

test.skip('this is skipped', () => {
  expect(true).toBe(true);
});
