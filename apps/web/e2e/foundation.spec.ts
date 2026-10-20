import { expect, test } from '@playwright/test'
import { signIn, uniqueEmail } from './helpers'

test('owner creates a hunt and a partner joins through an invite link', async ({ browser }) => {
  const ownerEmail = uniqueEmail('ala')
  const partnerEmail = uniqueEmail('bartek')
  const owner = await (await browser.newContext()).newPage()
  const partner = await (await browser.newContext()).newPage()

  // Owner signs in and creates a hunt.
  await owner.goto('/')
  await signIn(owner, ownerEmail)
  await expect(owner.getByRole('heading', { name: 'Your hunts' })).toBeVisible()
  await owner.getByRole('link', { name: '+ New hunt' }).click()
  await owner.getByLabel('Name').fill('Warsaw flat 2026')
  await owner.getByRole('button', { name: 'Create hunt' }).click()
  await expect(owner.getByRole('heading', { name: 'Hunt settings' })).toBeVisible()

  // Owner creates an invite link.
  await owner.getByRole('button', { name: 'Create invite link' }).click()
  const inviteUrl = await owner.getByTestId('invite-url').first().inputValue()
  expect(inviteUrl).toContain('#/join/')

  // Partner opens the link, signs in, and lands back on the join screen.
  await partner.goto(inviteUrl)
  await expect(partner.getByText('Sign in to join the hunt')).toBeVisible()
  await signIn(partner, partnerEmail)
  await expect(partner.getByText('Warsaw flat 2026')).toBeVisible()
  await partner.getByRole('button', { name: 'Join hunt' }).click()
  await expect(partner.getByRole('link', { name: 'Deck' })).toBeVisible()

  // Both see each other in the member list.
  await partner.getByRole('link', { name: 'Settings' }).click()
  const partnerName = partnerEmail.split('@')[0]!
  const ownerName = ownerEmail.split('@')[0]!
  await expect(partner.getByTestId('members')).toContainText(ownerName)
  await expect(partner.getByTestId('members')).toContainText(partnerName)
  await owner.reload()
  await expect(owner.getByTestId('members')).toContainText(partnerName)

  // The invite is single-use.
  const third = await (await browser.newContext()).newPage()
  await third.goto(inviteUrl)
  await signIn(third, uniqueEmail('cezary'))
  await expect(third.getByText('invalid, expired or already used')).toBeVisible()
})

test('an email outside the allowlist cannot sign up', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Email').fill(`stranger-${Date.now()}@gmail.com`)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByRole('alert')).toContainText("isn't on the access list")
})
