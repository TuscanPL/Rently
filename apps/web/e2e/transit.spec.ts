import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { signIn, uniqueEmail } from './helpers'

// Public transport trips to pins. The transit-routes function really runs here,
// but Transitous isn't reachable from the sandbox or CI, so its lookups fail and
// are stored as such; a found trip is then written with the service role to
// check how it's shown. The planner itself is covered by packages/edge/src/transit.test.ts.

const API_URL = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })

// SCREENSHOTS=<dir> saves a picture of each screen for a visual check.
async function snap(page: Page, name: string) {
  if (process.env.SCREENSHOTS)
    await page.screenshot({ path: `${process.env.SCREENSHOTS}/${name}.png`, fullPage: true })
}

test('pins carry an arrival time and listings show the public transport trip', async ({ page }) => {
  await page.route('**/functions/v1/geocode', async (route) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers })
    await route.fulfill({
      json: { found: true, cached: false, lat: 52.2297, lng: 21.0122, displayName: 'Centrum' },
      headers,
    })
  })

  await page.goto('/')
  await signIn(page, uniqueEmail('commuter'))
  await page.getByRole('link', { name: '+ New hunt' }).click()
  await page.getByLabel('Name').fill('Commute hunt')
  await page.getByRole('button', { name: 'Create hunt' }).click()

  // A pin you need to reach by Saturday noon.
  const pins = page.getByTestId('pins')
  await pins.getByRole('button', { name: 'Add pin' }).click()
  await pins.getByLabel('Name').fill('Mum')
  await pins.getByLabel('Type').selectOption('family')
  await pins.getByLabel('Day').selectOption({ label: 'Sat' })
  await pins.getByLabel('Time (Warsaw)').fill('12:00')
  await pins.getByTestId('location-search').fill('Centrum')
  await pins.getByRole('button', { name: 'Find' }).click()
  await snap(page, 'transit-pin-form')
  await pins.getByRole('button', { name: 'Save pin' }).click()
  await expect(pins.getByRole('listitem')).toContainText('arrive Sat 12:00')

  // A listing, placed straight in the database (geocoding is covered elsewhere).
  await page.getByRole('link', { name: 'List' }).click()
  await page.getByTestId('add-button').click()
  await page.getByRole('tab', { name: 'Text + photos' }).click()
  await page.getByLabel('Post text').fill('Mieszkanie 3 pokoje, 60 m2, 4000 zł')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Save listing' }).click()
  await expect(page.getByTestId('costs')).toBeVisible()
  const listingId = page.url().split('/l/')[1]!.split(/[/?]/)[0]!
  await admin.from('listings').update({ lat: 52.1808, lng: 20.9997 }).eq('id', listingId)

  // The app notices the missing trip and asks transit-routes for it. Transitous
  // is unreachable here, so the function stores a failed lookup, and says so.
  const trip = page.getByTestId('pin-trip')
  await expect(trip).toContainText('Mum', { timeout: 20_000 })
  await expect(trip).toContainText("Couldn't look up the public transport trip", {
    timeout: 30_000,
  })
  const { data: failed } = await admin
    .from('listing_routes')
    .select('status')
    .eq('listing_id', listingId)
    .single()
  expect(failed?.status).toBe('error')

  // A found trip, as the function would store it, shows up live.
  const { data: listing } = await admin
    .from('listings')
    .select('hunt_id')
    .eq('id', listingId)
    .single()
  const { data: pin } = await admin
    .from('pins')
    .select('id')
    .eq('hunt_id', listing!.hunt_id)
    .single()
  await admin.from('listing_routes').upsert({
    listing_id: listingId,
    pin_id: pin!.id,
    status: 'ok',
    duration_min: 41,
    transfers: 1,
    walk_min: 9,
    legs: [
      { mode: 'WALK', line: null, from: null, to: 'Bokserska', minutes: 5 },
      { mode: 'TRAM', line: '17', from: 'Bokserska', to: 'Wilanowska', minutes: 15 },
      { mode: 'SUBWAY', line: 'M1', from: 'Wilanowska', to: 'Centrum', minutes: 17 },
      { mode: 'WALK', line: null, from: 'Centrum', to: null, minutes: 4 },
    ],
  })
  await expect(trip).toContainText('🚆 41 min')
  await expect(trip).toContainText('1 transfer')
  await expect(trip).toContainText('arrive Sat 12:00')
  await expect(page.getByTestId('transit-legs')).toHaveText('🚶 5 · 🚋 17 · 🚇 M1 · 🚶 4')
  await page.getByTestId('distances').scrollIntoViewIfNeeded()
  await snap(page, 'transit-detail')

  // Cards show it next to the distance.
  await page.getByRole('link', { name: 'List' }).click()
  await expect(page.getByTestId('listing-card').getByTestId('transit-minutes')).toHaveText(
    '🚆 41 min',
  )
  await snap(page, 'transit-list')

  // Changing the pin's arrival time drops the stored trip, so it's looked up again.
  await page.getByRole('link', { name: 'Settings' }).click()
  await pins.getByRole('button', { name: 'Edit' }).click()
  await pins.getByLabel('Time (Warsaw)').fill('10:00')
  await pins.getByRole('button', { name: 'Save pin' }).click()
  await expect(pins.getByRole('listitem')).toContainText('arrive Sat 10:00')
  await expect
    .poll(async () => {
      const { data } = await admin
        .from('listing_routes')
        .select('status')
        .eq('listing_id', listingId)
        .maybeSingle()
      return data?.status ?? 'gone'
    })
    .not.toBe('ok')
})
