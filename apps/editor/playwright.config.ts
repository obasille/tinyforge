import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // A cold start loads the compiler (Binaryen) before the first game runs.
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: `vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/__tf/files.json`,
    reuseExistingServer: !process.env.CI,
    env: { TF_NO_CHECKER: '1' },
  },
});
