// Fixture-local vitest config — see pass-only/vitest.config.mjs for rationale.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**'],
    globals: false,
  },
});
