// Fixture-local vitest config: scopes test discovery to THIS dir so the
// orchestrator's `npx vitest` invocation doesn't accidentally walk upward and
// pick up the cli package's own test suite.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**'],
    globals: false,
  },
});
