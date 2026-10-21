import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { signIn, uniqueEmail } from './helpers'

// Browse a saved Otodom search. Otodom isn't reachable from the sandbox or CI,
// so the browser's call to search-refresh is answered here, writing the cards
// the way the function would (it's covered by packages/edge/src/search.test.ts).
// The last test lets the real function run and checks the failure is shown.

const API_URL = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })

const SEARCH_URL =
  'https://www.otodom.pl/pl/wyniki/wynajem/mieszkanie/mazowieckie/warszawa/warszawa/warszawa?roomsNumber=%5BTHREE%5D'

async function snap(page: Page, name: string) {
  if (process.env.SCREENSHOTS)
    await page.screenshot({ path: `${process.env.SCREENSHOTS}/${name}.png`, fullPage: true })
}

const ADS = [
  {
    external_id: '66500001',
    url: 'https://www.otodom.pl/pl/oferta/3-pokoje-balkon-skm-ID4uAAA',
    title: '3 pokoje, balkon, blisko SKM Służewiec',
    rent: 4300,
    admin_fee: 780,
    area_m2: 64.2,
    rooms: 3,
    floor: 4,
    district: 'Mokotów',
    address: 'ul. Bokserska 12, Warszawa',
    private_owner: true,
    photos: ['https://img.test/a1.jpg', 'https://img.test/a2.jpg'],
    posted_at: '2026-10-20T09:00:00Z',
  },
  {
    external_id: '66500002',
    url: 'https://www.otodom.pl/pl/oferta/kawalerka-ochota-ID4uBBB',
    title: 'Kawalerka Ochota',
    rent: 2900,
    admin_fee: null,
    area_m2: 28,
    rooms: 1,
    floor: 0,
    district: 'Ochota',
    address: 'Warszawa',
    private_owner: false,
    photos: [],
    posted_at: '2026-10-19T09:00:00Z',
  },
]

/** Answers search-refresh like the function: writes the given ads as this refresh's results. */
async function fakeRefresh(page: Page, ads: () => (typeof ADS)[number][], calls: { n: number }) {
  await page.route('**/functions/v1/search-refresh', async (route) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers })
    calls.n++
    const { searchId } = route.request().postDataJSON() as { searchId: string }
    const { data: search } = await admin
      .from('saved_searches')
      .select('*')
      .eq('id', searchId)
      .single()
    const now = new Date().toISOString()
    const { data: known } = await admin
      .from('search_results')
      .select('external_id')
      .eq('search_id', searchId)
    const knownIds = new Set((known ?? []).map((r) => r.external_id))
    const rows = ads().map((a) => ({
      ...a,
      search_id: searchId,
      hunt_id: search!.hunt_id,
      last_seen_at: now,
    }))
    // Same columns in every row of a batch, as the function sends them.
    await admin.from('search_results').upsert(rows.filter((r) => knownIds.has(r.external_id)))
    await admin
      .from('search_results')
      .upsert(
        rows.filter((r) => !knownIds.has(r.external_id)).map((r) => ({ ...r, first_seen_at: now })),
      )
    await admin
      .from('saved_searches')
      .update({
        last_refreshed_at: now,
        first_refreshed_at: search!.first_refreshed_at ?? now,
        last_total: 42,
        last_error: null,
      })
      .eq('id', searchId)
    const newCount = rows.filter((r) => !knownIds.has(r.external_id)).length
    await route.fulfill({
      headers,
      json: { refreshed: true, total: rows.length, newCount, pages: 1, totalResults: 42 },
    })
  })
}

async function newHunt(page: Page, name: string) {
  await page.goto('/')
  await signIn(page, uniqueEmail('browser'))
  await page.getByRole('link', { name: '+ New hunt' }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Create hunt' }).click()
  await expect(page.getByRole('heading', { name: 'Hunt settings' })).toBeVisible()
  await page.getByRole('link', { name: 'List', exact: true }).click()
  await page.getByRole('link', { name: 'Browse Otodom' }).click()
}

test('save an Otodom search, look at results, add one, hide one, pull to refresh', async ({
  page,
}) => {
  let ads = [...ADS]
  const calls = { n: 0 }
  await fakeRefresh(page, () => ads, calls)
  // The ads' photos, served here (they'd come from Otodom's CDN).
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
  await page.route('https://img.test/**', (route) =>
    route.fulfill({ body: png, contentType: 'image/png' }),
  )
  await newHunt(page, 'Browse hunt')

  // The List tab stays highlighted on Browse.
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'List', exact: true }),
  ).toHaveClass(/text-brand-700/)

  // Setting up the search; only Otodom search links are accepted.
  const form = page.getByTestId('search-form')
  await form.getByLabel('Otodom search link').fill('https://www.otodom.pl/pl/oferta/some-ad-ID1')
  await expect(form.getByText("That isn't an Otodom search results link")).toBeVisible()
  await expect(form.getByRole('button', { name: 'Save search' })).toBeDisabled()
  await form.getByLabel('Otodom search link').fill(SEARCH_URL)
  await snap(page, 'browse-setup')
  await form.getByRole('button', { name: 'Save search' }).click()

  // Saving fetches the first results straight away.
  const cards = page.getByTestId('search-result')
  await expect(cards).toHaveCount(2)
  expect(calls.n).toBe(1)
  await expect(cards.first()).toContainText('3 pokoje, balkon, blisko SKM Służewiec')
  await expect(cards.first()).toContainText('5 080 zł')
  await expect(cards.first()).toContainText('Private owner')
  await expect(page.getByTestId('search-status')).toContainText('42 on Otodom, showing 2')
  await snap(page, 'browse-results')

  // A closer look without leaving the app, then add it to the hunt.
  await cards.first().getByRole('button').first().click()
  const sheet = page.getByTestId('search-sheet')
  await expect(sheet.locator('img')).toHaveCount(2)
  await expect(sheet).toContainText('ul. Bokserska 12, Warszawa · Mokotów')
  await expect(sheet.getByRole('link', { name: 'Open on Otodom ↗' })).toHaveAttribute(
    'href',
    ADS[0]!.url,
  )
  await snap(page, 'browse-sheet')
  await sheet.getByRole('button', { name: 'Add to hunt' }).click()
  await expect(sheet.getByRole('button', { name: 'In hunt' })).toBeDisabled({ timeout: 30_000 })
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(cards.first()).toContainText('✓ In hunt')
  await page.getByRole('link', { name: 'Our listings' }).click()
  await expect(page.getByTestId('listing-card')).toHaveCount(1)
  await page.getByRole('link', { name: 'Browse Otodom' }).click()

  // Hiding is for the whole hunt; hidden ads can be shown again.
  await cards.nth(1).getByRole('button', { name: 'Hide' }).click()
  await expect(cards).toHaveCount(1)
  await page.getByRole('button', { name: 'Show hidden (1)' }).click()
  await expect(cards).toHaveCount(2)
  await page.getByRole('button', { name: 'Hide hidden ads' }).click()

  // Pull down with a finger to refresh; a newly listed ad is marked New.
  ads = [
    ...ADS,
    {
      ...ADS[1]!,
      external_id: '66509999',
      url: 'https://www.otodom.pl/pl/oferta/nowe-ID9',
      title: 'Brand new flat',
    },
  ]
  const cdp = await page.context().newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y?: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: y == null ? [] : [{ x: 200, y }] })
  await page.evaluate(() => window.scrollTo(0, 0))
  await touch('touchStart', 250)
  for (let y = 260; y <= 500; y += 20) await touch('touchMove', y)
  await expect(page.getByTestId('pull-indicator')).toContainText('Release to refresh')
  await touch('touchEnd')
  await expect(page.getByRole('status')).toContainText('1 new ad')
  expect(calls.n).toBe(2)
  const fresh = cards.filter({ hasText: 'Brand new flat' })
  await expect(fresh).toContainText('New')
  await expect(cards.filter({ hasText: 'Kawalerka Ochota' })).toHaveCount(0)
})

test('a search Otodom does not answer shows why', async ({ page }) => {
  await newHunt(page, 'Offline browse')
  const form = page.getByTestId('search-form')
  await form.getByLabel('Otodom search link').fill(SEARCH_URL)
  await form.getByRole('button', { name: 'Save search' }).click()
  // The real function runs; Otodom is unreachable from here.
  // Unreachable, or "busy" when other adds are queued for otodom.pl in the shared throttle.
  await expect(page.getByTestId('search-error')).toHaveText(
    /Last refresh failed: (Couldn't reach Otodom|Otodom is busy)/,
    { timeout: 30_000 },
  )
  await expect(page.getByTestId('search-status')).toContainText('Not loaded yet')
})
