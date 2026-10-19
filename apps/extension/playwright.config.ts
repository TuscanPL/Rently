import { defineConfig } from '@playwright/test'

// Loads dist/chrome (run `pnpm build` first) into Chromium and drives the popup
// against the local Supabase stack. Same env overrides as apps/web
// (SUPABASE_API_URL, MAILPIT_URL) when several stacks run side by side.
const apiUrl = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: { trace: 'retain-on-failure' },
  webServer: {
    // ingest-listing; refresh-listings answers 401 without its secret once the runtime is up.
    command: 'pnpm --dir ../.. functions:serve',
    url: `${apiUrl}/functions/v1/refresh-listings`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
