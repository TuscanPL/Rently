import { expect, test, type Page } from '@playwright/test'
import { signIn, uniqueEmail } from './helpers'

// OpenStreetMap (tiles and Nominatim) is blocked in the sandbox and CI, so the
// browser's calls to the `geocode` function are answered here; the function
// itself is covered by packages/edge/src/geocode.test.ts. Markers still render
// without tiles, so the map is checked through the DOM.

const PLACES: Record<string, { lat: number; lng: number }> = {
  'postępu 18': { lat: 52.1808, lng: 20.9997 },
  'wołoska 12': { lat: 52.185, lng: 21.001 },
  'grójecka 100': { lat: 52.21, lng: 20.98 },
}

// SCREENSHOTS=<dir> saves a picture of each screen for a visual check.
async function snap(page: Page, name: string) {
  if (process.env.SCREENSHOTS)
    await page.screenshot({ path: `${process.env.SCREENSHOTS}/${name}.png` })
}

async function mockGeocode(page: Page) {
  await page.route('**/functions/v1/geocode', async (route) => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
    }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers })
    const { q } = route.request().postDataJSON() as { q: string }
    const key = Object.keys(PLACES).find((k) => q.toLowerCase().includes(k))
    const body = key
      ? { found: true, cached: false, ...PLACES[key], displayName: `${key}, Warszawa` }
      : { found: false, cached: false }
    await route.fulfill({ json: body, headers })
  })
}

async function addListing(page: Page, text: string, address: string, district: string) {
  await page.getByRole('link', { name: 'List' }).click()
  await page.getByTestId('add-button').click()
  await page.getByRole('tab', { name: 'Text + photos' }).click()
  await page.getByLabel('Post text').fill(text)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('District').fill(district)
  await page.getByLabel('Address').fill(address)
  await page.getByRole('button', { name: 'Save listing' }).click()
  await expect(page.getByTestId('costs')).toBeVisible()
  // Saving the edit form places it on the map from its address.
  await page.getByRole('link', { name: 'Edit' }).click()
  await expect(page.getByTestId('listing-location')).toBeVisible()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('distances')).toBeVisible()
}

test('pins, distances, map and compare', async ({ page }) => {
  await mockGeocode(page)
  await page.goto('/')
  await signIn(page, uniqueEmail('mapper'))
  await page.getByRole('link', { name: '+ New hunt' }).click()
  await page.getByLabel('Name').fill('Map hunt')
  await page.getByRole('button', { name: 'Create hunt' }).click()
  await expect(page.getByRole('heading', { name: 'Hunt settings' })).toBeVisible()

  // A pin found by address search.
  const pins = page.getByTestId('pins')
  await pins.getByRole('button', { name: 'Add pin' }).click()
  await pins.getByLabel('Name').fill('Office')
  await pins.getByLabel('Type').selectOption('work')
  await pins.getByTestId('location-search').fill('Postępu 18')
  await pins.getByRole('button', { name: 'Find' }).click()
  await expect(pins.getByText('Placed at 52.18080, 20.99970')).toBeVisible()
  await expect(pins.locator('.picked-marker')).toHaveCount(1)
  await snap(page, 'pin-form')
  await pins.getByRole('button', { name: 'Save pin' }).click()
  await expect(pins.getByRole('listitem')).toHaveCount(1)
  await expect(pins.getByRole('listitem')).toContainText('Office')
  await snap(page, 'pins')

  await addListing(page, 'Mieszkanie 3 pokoje, 60 m2, 4000 zł', 'Wołoska 12', 'Mokotów')
  await expect(page.getByTestId('distances')).toContainText('Office')
  await expect(page.getByTestId('distances')).toContainText('480 m')
  await addListing(page, 'Mieszkanie 3 pokoje, 70 m2, 4500 zł', 'Grójecka 100', 'Ochota')
  await expect(page.getByTestId('distances')).toContainText('3,5 km')
  await snap(page, 'detail')

  // Cards show the distance to the nearest pins.
  await page.getByRole('link', { name: 'List' }).click()
  const cards = page.getByTestId('listing-card')
  await expect(cards).toHaveCount(2)
  await expect(cards.filter({ hasText: '4 000 zł' }).getByTestId('pin-distances')).toContainText(
    '480 m Office',
  )

  // The map shows both listings and the pin; tapping a listing opens its card.
  await page.getByRole('link', { name: 'Map' }).click()
  await expect(page.locator('path.listing-marker')).toHaveCount(2)
  await expect(page.locator('.pin-marker')).toHaveCount(1)
  // Alone in the hunt, the listings you added are your yes, so they show as matches.
  await expect(page.locator('path.listing-marker--match')).toHaveCount(2)
  await expect(page.getByTestId('unlocated')).toBeHidden()
  await expect(page.getByText('OpenStreetMap')).toBeVisible()
  await snap(page, 'map')
  await page.locator('path.listing-marker').first().click({ force: true })
  await expect(page.getByTestId('map-card')).toBeVisible()
  await expect(page.getByTestId('map-card')).toContainText(/4\s[05]00\szł/)
  await snap(page, 'map-card')

  // Compare both: cheapest total and closest to the pin win their rows.
  await page.getByRole('link', { name: 'List' }).click()
  await page.getByRole('button', { name: 'Compare' }).click()
  await page.getByTestId('compare-checkbox').nth(0).check()
  await page.getByTestId('compare-checkbox').nth(1).check()
  await snap(page, 'list-compare')
  await page.getByRole('button', { name: 'Compare (2)' }).click()
  const table = page.getByTestId('compare-table')
  await expect(table).toBeVisible()
  await snap(page, 'compare')
  await expect(table.locator('[data-row="total"] [data-best]')).toHaveCount(1)
  await expect(table.locator('[data-row="total"] [data-best]')).toContainText('4 000 zł')
  await expect(table.locator('[data-row="area"] [data-best]')).toContainText('70 m²')
  await expect(table.locator('[data-row^="pin-"] [data-best]')).toContainText('480 m')
  // Both have 3 rooms: a tie, so no highlight.
  await expect(table.locator('[data-row="rooms"] [data-best]')).toHaveCount(0)
})
