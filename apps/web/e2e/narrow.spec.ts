import { expect, test, type Page } from '@playwright/test'
import { signIn, uniqueEmail } from './helpers'

// Every form has to fit a small phone (360 px wide) without scrolling sideways.

test.use({ viewport: { width: 360, height: 740 } })

async function snap(page: Page, name: string) {
  if (process.env.SCREENSHOTS)
    await page.screenshot({ path: `${process.env.SCREENSHOTS}/${name}.png`, fullPage: true })
}

/** Fails when the page, or any element on it, sticks out past the right edge. */
async function expectFits(page: Page, name: string) {
  await snap(page, name)
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const wide = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.getBoundingClientRect().right > width + 1)
      .filter((el) => !el.closest('.leaflet-container'))
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80))
    return { scroll: document.documentElement.scrollWidth - width, wide: wide.slice(0, 5) }
  })
  expect(overflow, name).toEqual({ scroll: 0, wide: [] })
}

test('forms fit a 360 px phone', async ({ page }) => {
  await page.goto('/')
  await signIn(page, uniqueEmail('narrow'))

  await page.getByRole('link', { name: '+ New hunt' }).click()
  await expectFits(page, 'new-hunt')
  await page.getByLabel('Name').fill('Narrow hunt')
  await page.getByRole('button', { name: 'Create hunt' }).click()
  await expect(page).toHaveURL(/\/h\/[^/]+\//)

  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('criteria')).toBeVisible()
  await expectFits(page, 'settings')
  await page.getByRole('button', { name: 'Add pin' }).click()
  await expect(page.getByTestId('pin-form')).toBeVisible()
  await expectFits(page, 'settings-pin-form')

  await page.getByRole('link', { name: 'List' }).click()
  await page.getByTestId('add-button').click()
  await expectFits(page, 'add-listing')
  await page.getByRole('tab', { name: 'Text + photos' }).click()
  await page.getByLabel('Post text').fill('3 pokoje, 60 m², 3200 zł')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByLabel('District')).toBeVisible()
  await expectFits(page, 'listing-form')
  await page.getByLabel('District').fill('Mokotów')
  await page.getByRole('button', { name: 'Save listing' }).click()
  await expect(page.getByTestId('costs')).toBeVisible()
  await expectFits(page, 'listing-detail')
  await page.getByRole('link', { name: 'Edit' }).click()
  await expect(page.getByTestId('listing-location')).toBeVisible()
  await expectFits(page, 'listing-edit')

  await page.goto('/#/account')
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
  await expectFits(page, 'account')
})
