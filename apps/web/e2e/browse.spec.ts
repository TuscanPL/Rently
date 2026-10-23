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

const PAGE_TWO = [
  {
    ...ADS[1]!,
    external_id: '66400001',
    url: 'https://www.otodom.pl/pl/oferta/older-flat-ID4wOLD',
    title: 'Older flat from page 2',
    posted_at: '2026-10-01T09:00:00Z',
  },
]

/** The full ad behind a card, as the listing parser reads it from the ad page. */
function adDetail(ad: (typeof ADS)[number]) {
  return {
    source: 'otodom',
    url: ad.url,
    title: ad.title,
    description: `${ad.title}. Jasne mieszkanie z balkonem, 5 minut pieszo do SKM.`,
    rent: ad.rent,
    adminFee: ad.admin_fee ?? undefined,
    deposit: 8600,
    areaM2: ad.area_m2,
    rooms: ad.rooms,
    floor: ad.floor,
    totalFloors: 6,
    district: ad.district,
    address: ad.address,
    advertiserType: ad.private_owner ? 'private' : 'agency',
    features: { petsAllowed: true, balcony: true },
    photos: [...ad.photos, 'https://img.test/a3.jpg'],
  }
}

/**
 * Answers search-refresh like the function: a refresh or load-more writes the
 * given ads as that page's results; opening a card stores and returns its full ad.
 */
async function fakeRefresh(
  page: Page,
  ads: (resultPage: number) => (typeof ADS)[number][],
  calls: { n: number; detail?: number },
) {
  await page.route('**/functions/v1/search-refresh', async (route) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers })
    const body = route.request().postDataJSON() as {
      searchId: string
      page?: number
      externalId?: string
    }
    const { searchId } = body
    if (body.externalId) {
      calls.detail = (calls.detail ?? 0) + 1
      const ad = [...ads(1), ...ads(2)].find((a) => a.external_id === body.externalId)!
      const detail = adDetail(ad)
      await admin
        .from('search_results')
        .update({ detail, detail_fetched_at: new Date().toISOString() })
        .eq('search_id', searchId)
        .eq('external_id', body.externalId)
      return route.fulfill({ headers, json: { detail, fetched: true } })
    }
    calls.n++
    const resultPage = body.page ?? 1
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
    const rows = ads(resultPage).map((a) => ({
      ...a,
      search_id: searchId,
      hunt_id: search!.hunt_id,
      last_seen_at: now,
    }))
    // Same columns in every row of a batch, as the function sends them.
    await admin.from('search_results').upsert(rows.filter((r) => knownIds.has(r.external_id)))
    await admin.from('search_results').upsert(
      rows
        .filter((r) => !knownIds.has(r.external_id))
        // Older ads reached by scrolling aren't new.
        .map((r) => ({ ...r, first_seen_at: resultPage > 1 ? search!.first_refreshed_at! : now })),
    )
    await admin
      .from('saved_searches')
      .update(
        resultPage > 1
          ? { loaded_pages: resultPage }
          : {
              last_refreshed_at: now,
              first_refreshed_at: search!.first_refreshed_at ?? now,
              last_total: 42,
              last_error: null,
              loaded_pages: 1,
              total_pages: 2,
            },
      )
      .eq('id', searchId)
    const newCount = resultPage > 1 ? 0 : rows.filter((r) => !knownIds.has(r.external_id)).length
    await route.fulfill({
      headers,
      json: {
        refreshed: true,
        total: rows.length,
        newCount,
        page: resultPage,
        loadedPages: resultPage,
        totalPages: 2,
        totalResults: 42,
      },
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
  const calls: { n: number; detail?: number } = { n: 0 }
  await fakeRefresh(page, (p) => (p === 1 ? ads : PAGE_TWO), calls)
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
  await form.getByRole('tab', { name: 'Paste a link' }).click()
  await form.getByLabel('Otodom search link').fill('https://www.otodom.pl/pl/oferta/some-ad-ID1')
  await expect(form.getByText("That isn't an Otodom search results link")).toBeVisible()
  await expect(form.getByRole('button', { name: 'Search' })).toBeDisabled()
  await form.getByLabel('Otodom search link').fill(SEARCH_URL)
  await snap(page, 'browse-setup')
  await form.getByRole('button', { name: 'Search' }).click()

  // Saving fetches the first results straight away.
  const cards = page.getByTestId('search-result')
  await expect(cards).toHaveCount(2)
  expect(calls.n).toBe(1)
  await expect(cards.first()).toContainText('3 pokoje, balkon, blisko SKM Służewiec')
  await expect(cards.first()).toContainText('5 080 zł')
  await expect(cards.first()).toContainText('Private owner')
  await expect(page.getByTestId('search-status')).toContainText('42 on Otodom, showing 2')
  await snap(page, 'browse-results')

  // Swiping a card's photos to the last one brings in the rest from the full ad.
  const strip = cards.first().getByTestId('result-photos')
  await expect(strip.locator('img')).toHaveCount(2)
  await expect(cards.first().getByTestId('photo-counter')).toHaveText('1 / 2')
  await strip.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await expect(strip.locator('img')).toHaveCount(3)
  await expect(cards.first().getByTestId('photo-counter')).toHaveText('2 / 3')
  expect(calls.detail).toBe(1)

  // A closer look without leaving the app: the full ad is already there, then add it.
  await cards.first().getByRole('button').first().click()
  const sheet = page.getByTestId('search-sheet')
  await expect(sheet).toContainText('ul. Bokserska 12, Warszawa · Mokotów')
  await expect(sheet.getByTestId('detail-description')).toContainText('5 minut pieszo do SKM')
  await expect(sheet.locator('img')).toHaveCount(3)
  await expect(sheet).toContainText('Deposit (kaucja)')
  await expect(sheet).toContainText('4 / 6')
  expect(calls.detail).toBe(1)
  await expect(sheet.getByRole('link', { name: 'Open on Otodom ↗' })).toHaveAttribute(
    'href',
    ADS[0]!.url,
  )
  await snap(page, 'browse-sheet')
  await expect(sheet.getByRole('button', { name: 'Add to hunt' })).toBeVisible()
  await sheet.getByRole('button', { name: '♥ Add as liked' }).click()
  await expect(sheet.getByRole('button', { name: 'In hunt' })).toBeDisabled({ timeout: 30_000 })
  // "Add as liked" is this member's yes.
  const huntId = page.url().split('/h/')[1]!.split('/')[0]!
  // (The listing can show up over Realtime a moment before the vote is written.)
  await expect
    .poll(async () => {
      const { data } = await admin
        .from('votes')
        .select('swipe, listings!inner(hunt_id)')
        .eq('listings.hunt_id', huntId)
      return data?.map((v) => v.swipe)
    })
    .toEqual(['yes'])
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(cards.first()).toContainText('✓ In hunt')
  // Opening it again uses the stored ad. The page behind stays put while the
  // sheet is open, whatever is scrolled over it, and is where it was after.
  await page.setViewportSize({ width: 390, height: 500 })
  await cards.first().getByRole('button').first().click()
  await expect(sheet.getByTestId('detail-description')).toBeVisible()
  expect(calls.detail).toBe(1)
  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('fixed')
  const pinnedTop = await page.evaluate(() => document.body.style.top)
  // The page was scrolled (the tapped card is lower down) and is held there.
  const before = -parseInt(pinnedTop)
  expect(before).toBeGreaterThan(0)
  await sheet.hover()
  await page.mouse.wheel(0, 2000)
  await page.mouse.wheel(0, -2000)
  await page.mouse.wheel(0, 2000)
  expect(await page.evaluate(() => document.body.style.top)).toBe(pinnedTop)
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('')
  expect(await page.evaluate(() => window.scrollY)).toBe(before)
  await page.setViewportSize({ width: 390, height: 844 })
  // The listing is saved from the full ad, without fetching it again.
  await page.getByRole('link', { name: 'Our listings' }).click()
  await expect(page.getByTestId('listing-card')).toHaveCount(1)
  await page.getByTestId('listing-card').click()
  await expect(page.getByText('5 minut pieszo do SKM')).toBeVisible()
  await page.goBack()
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

  // Scrolling to the end loads the next page, which isn't marked new.
  await expect(page.getByTestId('load-more')).toHaveText('Load more (page 2 of 2)')
  // (The list here is too short to scroll; on a full page scrolling to the end does this.)
  await page.getByTestId('load-more').click()
  const older = cards.filter({ hasText: 'Older flat from page 2' })
  await expect(older).toHaveCount(1)
  expect(calls.n).toBe(3)
  await expect(older).not.toContainText('New')
  await expect(page.getByText("That's all Otodom has for this search.")).toBeVisible()
  await expect(page.getByTestId('load-more')).toHaveCount(0)
})

test('build a search from filters and the hunt criteria', async ({ page }) => {
  const calls = { n: 0 }
  await fakeRefresh(page, (p) => (p === 1 ? ADS : PAGE_TWO), calls)
  await newHunt(page, 'Builder hunt')
  const huntId = page.url().split('/h/')[1]!.split('/')[0]!
  await admin
    .from('hunts')
    .update({ criteria: { maxTotalMonthly: 5000, minRooms: 3, minAreaM2: 55, privateOnly: true } })
    .eq('id', huntId)
  await page.goto(`/#/h/${huntId}/list/browse`)
  await page.reload()

  const form = page.getByTestId('search-form')
  await expect(form.getByRole('tab', { name: 'Set filters' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await form.getByRole('button', { name: 'Use our hunt criteria' }).click()
  await expect(form.getByLabel('Max rent (zł)')).toHaveValue('5000')
  await expect(form.getByLabel('Rooms from')).toHaveValue('3')
  await expect(form.getByLabel('Min area (m²)')).toHaveValue('55')
  await expect(form.getByLabel('Private owners only (bez pośredników)')).toBeChecked()
  await form.getByLabel('District').selectOption({ label: 'Mokotów' })
  // formatPLN groups thousands with a no-break space.
  const label = /Mokotów · 3\+ rooms · up to 5\s000\szł · private/
  await expect(form.getByLabel('Name')).toHaveAttribute('placeholder', label)

  const href = new URL((await form.getByTestId('built-url').getAttribute('href'))!)
  expect(href.pathname).toBe(
    '/pl/wyniki/wynajem/mieszkanie/mazowieckie/warszawa/warszawa/warszawa/mokotow',
  )
  expect(href.searchParams.get('priceMax')).toBe('5000')
  expect(href.searchParams.get('areaMin')).toBe('55')
  expect(href.searchParams.get('roomsNumber')).toBe('[THREE,FOUR,FIVE,SIX,SEVEN,EIGHT,NINE,TEN]')
  expect(href.searchParams.get('ownerTypeSingleSelect')).toBe('PRIVATE')
  expect(href.searchParams.get('by')).toBe('LATEST')
  await snap(page, 'browse-builder')

  await form.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByTestId('search-result')).toHaveCount(2)
  await expect(page.getByText(label)).toBeVisible()
  const { data: saved } = await admin
    .from('saved_searches')
    .select('url, params')
    .eq('hunt_id', huntId)
    .single()
  expect(saved!.url).toBe(href.toString())
  expect(saved!.params).toMatchObject({ city: 'warszawa', district: 'mokotow', roomsMin: 3 })

  // Editing reopens the filters as they were.
  await page.getByRole('button', { name: 'Edit' }).click()
  await expect(form.getByLabel('District')).toHaveValue('mokotow')
  await expect(form.getByLabel('Max rent (zł)')).toHaveValue('5000')
  await form.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('search-result')).toHaveCount(2)
})

test('a search Otodom does not answer shows why', async ({ page }) => {
  await newHunt(page, 'Offline browse')
  const form = page.getByTestId('search-form')
  await form.getByRole('tab', { name: 'Paste a link' }).click()
  await form.getByLabel('Otodom search link').fill(SEARCH_URL)
  await form.getByRole('button', { name: 'Search' }).click()
  // The real function runs; Otodom is unreachable from here.
  // Unreachable, or "busy" when other adds are queued for otodom.pl in the shared throttle.
  await expect(page.getByTestId('search-error')).toHaveText(
    /Last refresh failed: (Couldn't reach Otodom|Otodom is busy)/,
    { timeout: 30_000 },
  )
  await expect(page.getByTestId('search-status')).toContainText('Not loaded yet')
})

test('scrolling to the end of a long list loads the next page', async ({ page }) => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    ...ADS[0]!,
    external_id: `6680${String(i).padStart(4, '0')}`,
    url: `https://www.otodom.pl/pl/oferta/flat-${i}-ID${i}`,
    title: `Flat number ${i + 1}`,
  }))
  const calls = { n: 0 }
  await fakeRefresh(page, (p) => (p === 1 ? many : PAGE_TWO), calls)
  await newHunt(page, 'Scroll hunt')
  const form = page.getByTestId('search-form')
  await form.getByRole('tab', { name: 'Paste a link' }).click()
  await form.getByLabel('Otodom search link').fill(SEARCH_URL)
  await form.getByRole('button', { name: 'Search' }).click()
  const cards = page.getByTestId('search-result')
  await expect(cards).toHaveCount(20)
  expect(calls.n).toBe(1)

  // Nothing more loads until the user scrolls; then reaching the end does it.
  await page.waitForTimeout(500)
  expect(calls.n).toBe(1)
  await page.mouse.wheel(0, 20_000)
  await expect(cards).toHaveCount(21)
  expect(calls.n).toBe(2)
})
