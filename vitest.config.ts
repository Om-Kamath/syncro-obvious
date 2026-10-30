import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Per-file override via `@vitest-environment jsdom` for DOM tests.
    environment: 'node',
    // Playwright e2e specs live in tests/e2e and run via `playwright test`.
    exclude: ['**/node_modules/**', 'tests/e2e/**'],
  },
});
