import { defineConfig } from 'vitest/config';

// Unit tests for the dev server plugins (the UI is tested with Playwright, in e2e/).
export default defineConfig({
  test: {
    include: ['vite/**/*.test.ts'],
  },
});
