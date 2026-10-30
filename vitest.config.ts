import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Per-file override via `@vitest-environment jsdom` for DOM tests.
    environment: 'node',
    // Playwright e2e specs live in tests/e2e and run via `playwright test`.
    exclude: ['**/node_modules/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      // Measure shipped source only; test files stay excluded via vitest defaults.
      include: ['src/**'],
      // `text` prints the % table in the CI log; `json-summary` feeds the artifact.
      reporter: ['text', 'html', 'json-summary'],
    },
  },
});
