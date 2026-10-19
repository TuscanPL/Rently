import { expect, test } from '@playwright/test'
import { fetchSignInCode, signIn, uniqueEmail } from './helpers'

// The sign-in email carries a code next to the link, for when the link would
// open in another browser (installed PWA) and for the browser extension.
test('signs in with the code from the email', async ({ browser }) => {
  const email = uniqueEmail('kod')

  // First sign-in creates the account (the extension only signs in existing users).
  const first = await (await browser.newContext()).newPage()
  await first.goto('/')
  await signIn(first, email)
  await expect(first.getByRole('heading', { name: 'Your hunts' })).toBeVisible()

  const page = await (await browser.newContext()).newPage()
  await page.goto('/')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByTestId('link-sent')).toBeVisible()
  await page.getByRole('button', { name: 'Have a code? Enter it' }).click()

  await page.getByLabel('Code from the email').fill('000000')
  await page.getByRole('button', { name: 'Sign in with code' }).click()
  await expect(page.getByRole('alert')).toContainText('wrong or has expired')

  const code = await fetchSignInCode(email)
  expect(code).toMatch(/^\d{6}$/)
  await page.getByLabel('Code from the email').fill(code)
  await page.getByRole('button', { name: 'Sign in with code' }).click()
  await expect(page.getByRole('heading', { name: 'Your hunts' })).toBeVisible()
})
