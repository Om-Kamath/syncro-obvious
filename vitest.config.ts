import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Per-file override via `@vitest-environment jsdom` for DOM tests.
    environment: 'node',
  },
});
