import { defineConfig, devices } from '@playwright/test';

// The static build (pnpm build:editor) served by `vite preview`, which sends
// the deployed site's Content-Security-Policy (vite/site-headers.ts).
// Run with `pnpm test:e2e:static`; it builds first. Not part of `pnpm test:e2e`.
const PORT = 4174;

export default defineConfig({
  testDir: './e2e-static',
  timeout: 60_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: `vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
