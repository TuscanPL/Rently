import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { signIn, uniqueEmail } from './helpers'

// Milestone 8: duplicate merge, price-change badges and "Check now".
// The daily job itself is covered by packages/edge/src/refresh.test.ts; here the
// price change is written straight to the database with the service role.

const API_URL = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })

async function newHunt(page: Page) {
  await page.goto('/')
  await signIn(page, uniqueEmail('upkeep'))
  await page.getByRole('link', { name: '+ New hunt' }).click()
  await page.getByLabel('Name').fill('Upkeep hunt')
  await page.getByRole('button', { name: 'Create hunt' }).click()
  await expect(page.getByRole('heading', { name: 'Hunt settings' })).toBeVisible()
  await page.getByRole('link', { name: 'List' }).click()
}

async function addFromText(page: Page, text: string, district: string) {
  await page.getByTestId('add-button').click()
  await page.getByRole('tab', { name: 'Text + photos' }).click()
  await page.getByLabel('Post text').fill(text)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('District').fill(district)
  await page.getByRole('button', { name: 'Save listing' }).click()
  await expect(page.getByTestId('costs')).toBeVisible()
  return page.url().split('/').pop()!
}

test('a lookalike merges into the listing that was there first', async ({ page }) => {
  await newHunt(page)
  const firstId = await addFromText(
    page,
    'Słoneczne 3 pokoje na Mokotowie, 62 m2, 4200 zł',
    'Mokotów',
  )

  await page.getByRole('link', { name: 'List' }).click()
  await addFromText(
    page,
    'Mokotów 3 pokoje 62 m2, 4250 zł + czynsz administracyjny 700 zł. Kaucja 5000 zł.',
    'mokotów',
  )
  await expect(page.getByTestId('duplicate-prompt')).toBeVisible()

  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: /^Merge into/ }).click()

  // Lands on the kept listing, whose empty fields came from the merged copy.
  await expect(page).toHaveURL(new RegExp(`/l/${firstId}$`))
  await expect(page.getByRole('heading', { level: 2 })).toContainText('Słoneczne 3 pokoje')
  const costs = page.getByTestId('costs')
  await expect(costs).toContainText('4 200 zł')
  await expect(costs).toContainText('700 zł')
  await expect(costs).toContainText('5 000 zł')
  await expect(page.getByText(/merged in the duplicate/)).toBeVisible()

  await page.getByRole('link', { name: 'List' }).click()
  await expect(page.getByTestId('listing-card')).toHaveCount(1)
})

test('price changes and removed ads show on the card and the listing', async ({ page }) => {
  await newHunt(page)
  const id = await addFromText(page, 'Kawalerka na Woli, 30 m2, 1 pokój, 2700 zł', 'Wola')

  // What the daily re-check writes when the rent drops by 200 zł.
  const { error } = await admin
    .from('listing_price_history')
    .insert([{ listing_id: id, rent: 2500, admin_fee: null }])
  expect(error).toBeNull()
  await admin.from('listings').update({ rent: 2500 }).eq('id', id)

  await page.reload()
  await expect(page.getByTestId('price-change')).toHaveText('Price dropped 200 zł')
  await expect(page.getByRole('heading', { name: 'Price history' })).toBeVisible()

  await page.getByRole('link', { name: 'List' }).click()
  const card = page.getByTestId('listing-card')
  await expect(card.getByTestId('price-change')).toHaveText('Price dropped 200 zł')

  // A price rise turns the badge amber.
  await admin.from('listing_price_history').insert({ listing_id: id, rent: 2650 })
  await admin.from('listings').update({ rent: 2650, is_active: false }).eq('id', id)
  await expect(card.getByTestId('price-change')).toHaveText('Price up 150 zł')
  await expect(card).toContainText('Ad removed')
})

test('"Check now" never marks an ad gone when the site can’t be reached', async ({ page }) => {
  await newHunt(page)
  await page.getByTestId('add-button').click()
  await page
    .getByLabel('Listing link')
    .fill('https://www.otodom.pl/pl/oferta/mieszkanie-2-pokoje-ochota-ID4zzzz')
  await page.getByRole('button', { name: 'Add listing' }).click()
  await expect(page.getByTestId('needs-details')).toBeVisible()

  // Listing sites are blocked from the sandbox and CI, so the answer is "unknown".
  await page.getByTestId('check-now').click()
  await expect(page.getByRole('status').filter({ hasText: "Couldn't reach the site" })).toBeVisible(
    { timeout: 30_000 },
  )
  await expect(page.getByText('The original ad is gone')).toBeHidden()
})
