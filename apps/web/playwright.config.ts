import { defineConfig, devices } from '@playwright/test'

// Runs against the local Supabase stack (`supabase start`) and the Vite dev server.
// Override the ports when several stacks run side by side (E2E_WEB_PORT, SUPABASE_API_URL, MAILPIT_URL).
const webPort = Number(process.env.E2E_WEB_PORT ?? 5173)
const apiUrl = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'retain-on-failure',
    ...devices['Pixel 7'],
  },
  webServer: [
    {
      command: `pnpm dev --strictPort --port ${webPort}`,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: true,
    },
    {
      // Edge functions; refresh-listings answers 401 without its secret once the runtime is up.
      command: 'pnpm --dir ../.. functions:serve',
      url: `${apiUrl}/functions/v1/refresh-listings`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
})
