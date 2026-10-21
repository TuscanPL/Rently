import { defineConfig, devices } from '@playwright/test'

// The service worker update flow, against real production builds: the test
// builds version A, serves it, rebuilds as version B, and expects the banner.
// Run with `pnpm e2e:update` (needs no Supabase stack).
export const UPDATE_PORT = 4180

export default defineConfig({
  testDir: './e2e-update',
  timeout: 120_000,
  retries: 0,
  use: { baseURL: `http://localhost:${UPDATE_PORT}`, ...devices['Pixel 7'] },
  webServer: {
    command: `APP_VERSION=update-a pnpm exec vite build --outDir dist-update --emptyOutDir && node e2e-update/static-server.mjs dist-update ${UPDATE_PORT}`,
    url: `http://localhost:${UPDATE_PORT}/index.html`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_BASE: '/' },
  },
})
