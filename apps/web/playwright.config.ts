import { defineConfig, devices } from '@playwright/test'

// Runs against the local Supabase stack (`supabase start`) and the Vite dev server.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    ...devices['Pixel 7'],
  },
  webServer: [
    {
      command: 'pnpm dev --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
    },
    {
      // Edge functions; refresh-listings answers 401 without its secret once the runtime is up.
      command: 'pnpm --dir ../.. functions:serve',
      url: 'http://127.0.0.1:54321/functions/v1/refresh-listings',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
})
