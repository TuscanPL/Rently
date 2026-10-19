import { expect, test, type Page } from '@playwright/test'
import { signIn, uniqueEmail } from './helpers'

// The sandbox and CI can't reach listing sites, so link adds exercise the
// "couldn't fetch → save partial → fill in details" path. Parsing itself is
// covered by the fixture tests in packages/parsers and packages/edge.

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

async function newHunt(page: Page) {
  await page.goto('/')
  await signIn(page, uniqueEmail('adder'))
  await page.getByRole('link', { name: '+ New hunt' }).click()
  await page.getByLabel('Name').fill('Ingest hunt')
  await page.getByRole('button', { name: 'Create hunt' }).click()
  await expect(page.getByRole('heading', { name: 'Hunt settings' })).toBeVisible()
  await page.getByRole('link', { name: 'List' }).click()
}

test('add by link, fill in missing details, re-adding finds the same listing', async ({ page }) => {
  await newHunt(page)
  await page.getByTestId('add-button').click()
  const url =
    'https://www.morizon.pl/oferta/wynajem-mieszkanie-warszawa-wola-48m2-mzn2041?utm_source=x'
  await page.getByLabel('Listing link').fill(url)
  await page.getByRole('button', { name: 'Add listing' }).click()

  await expect(
    page.getByRole('heading', { name: 'Wynajem mieszkanie warszawa wola 48m2 mzn2041' }),
  ).toBeVisible()
  await expect(page.getByTestId('needs-details')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open on Morizon ↗' })).toHaveAttribute('href', url)

  await page.getByRole('link', { name: 'Add details' }).click()
  await page.getByLabel('Rent', { exact: true }).fill('3600')
  await page.getByLabel('Admin fee (czynsz adm.)').fill('550')
  await page.getByLabel('Utilities (media)').fill('250')
  await page.getByLabel('Area (m²)').fill('48')
  await page.getByLabel('Rooms').fill('2')
  await page.getByLabel('District').fill('Wola')
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByTestId('needs-details')).toBeHidden()
  await expect(page.getByTestId('costs')).toContainText('4 400 zł')
  await expect(page.getByText(/edited rent, admin_fee/)).toBeVisible()

  await page.getByRole('link', { name: 'List' }).click()
  await expect(page.getByTestId('listing-card')).toHaveCount(1)
  await expect(page.getByTestId('listing-card')).toContainText('4 400 zł')

  // Same ad, different URL form: no new listing.
  await page.getByTestId('add-button').click()
  await page
    .getByLabel('Listing link')
    .fill('http://morizon.pl/oferta/wynajem-mieszkanie-warszawa-wola-48m2-mzn2041/')
  await page.getByRole('button', { name: 'Add listing' }).click()
  await expect(page.getByText('already in the hunt')).toBeVisible()
  await page.getByRole('link', { name: 'List' }).click()
  await expect(page.getByTestId('listing-card')).toHaveCount(1)
})

test('add from pasted text with a photo, then a lookalike is flagged as duplicate', async ({
  page,
}) => {
  await newHunt(page)
  const post = `Wynajmę mieszkanie 3 pokojowe, Mokotów
62 m2, 4 piętro / 6, winda, balkon.
Cena: 4 200 zł + czynsz administracyjny 750 zł + media ok. 300 zł. Kaucja 4200 zł. Bez pośredników.`

  await page.getByTestId('add-button').click()
  await page.getByRole('tab', { name: 'Text + photos' }).click()
  await page.getByLabel('Post text').fill(post)
  await page
    .getByTestId('photo-input')
    .setInputFiles({ name: 'flat.png', mimeType: 'image/png', buffer: PNG })
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByLabel('Rent', { exact: true })).toHaveValue('4200')
  await expect(page.getByLabel('Admin fee (czynsz adm.)')).toHaveValue('750')
  await expect(page.getByLabel('Area (m²)')).toHaveValue('62')
  await expect(page.getByLabel('Rooms')).toHaveValue('3')
  await expect(page.getByLabel('Advertiser')).toHaveValue('private')
  await page.getByLabel('District').fill('Mokotów')
  await page.getByRole('button', { name: 'Save listing' }).click()

  await expect(page.getByTestId('costs')).toContainText('5 250 zł')
  await expect(page.getByTestId('needs-details')).toBeHidden()
  // The uploaded photo is served from Storage through a signed URL.
  await expect(page.getByTestId('gallery').locator('img')).toHaveAttribute(
    'src',
    /\/storage\/v1\/object\/sign\//,
  )

  // A second post for the same flat gets the duplicate prompt.
  await page.getByRole('link', { name: 'List' }).click()
  await page.getByTestId('add-button').click()
  await page.getByRole('tab', { name: 'Text + photos' }).click()
  await page.getByLabel('Post text').fill('Mokotów 3 pokoje 62 m2, 4250 zł')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('District').fill('mokotów')
  await page.getByRole('button', { name: 'Save listing' }).click()
  await expect(page.getByTestId('duplicate-prompt')).toContainText(
    'Wynajmę mieszkanie 3 pokojowe, Mokotów',
  )
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Delete this one' }).click()
  await expect(page.getByTestId('listing-card')).toHaveCount(1)
})
