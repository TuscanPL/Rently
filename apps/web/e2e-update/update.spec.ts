import { execSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

// A new version is installed in the background and waits; the banner asks
// before switching to it, and "Update" reloads into the new version.

test('a new version shows the update banner and Update switches to it', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('login-version')).toHaveText('Version update-a')
  // Wait for version A's service worker to control the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r))
    }
  })

  // Deploy version B into the directory being served.
  execSync('pnpm exec vite build --outDir dist-update --emptyOutDir', {
    env: { ...process.env, APP_VERSION: 'update-b', VITE_BASE: '/' },
    stdio: 'ignore',
  })

  // Coming back to the app checks for a new version; nothing switches yet.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  const banner = page.getByTestId('update-banner')
  await expect(banner).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('login-version')).toHaveText('Version update-a')

  // "Later" hides it; the update is still there for the next time.
  await banner.getByRole('button', { name: 'Later' }).click()
  await expect(banner).toBeHidden()
  await page.reload()
  await expect(page.getByTestId('login-version')).toHaveText('Version update-a')
  await expect(banner).toBeVisible({ timeout: 30_000 })

  // "Update" activates the waiting version and reloads into it.
  await banner.getByRole('button', { name: 'Update' }).click()
  await expect(page.getByTestId('login-version')).toHaveText('Version update-b', {
    timeout: 30_000,
  })
  await expect(banner).toBeHidden()
})
