// Fixture: a test that never resolves, used to force the orchestrator's
// timeout branch.
// Excluded from main vitest run via cli/vitest.config.ts (__fixtures__ glob).
import { test } from 'vitest';

test('hangs forever', () => new Promise(() => {
  /* never resolve */
}));
