import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test, type BrowserContext } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const API = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321'
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'
// The local stack's well-known demo anon key.
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const WEB_APP = 'https://me.github.io/apartment-together/'
const LISTING_URL = 'https://www.otodom.pl/pl/oferta/3-pokoje-64-m-mokotow-blisko-skm-ID4tAbC'

const dist = fileURLToPath(new URL('../dist/chrome', import.meta.url))
const fixture = readFileSync(
  new URL('../../../packages/parsers/__fixtures__/otodom-ad.html', import.meta.url),
  'utf8',
)

/** Chrome derives an unpacked extension's id from its absolute path. */
function extensionId(path: string): string {
  const hex = createHash('sha256').update(path).digest('hex').slice(0, 32)
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')
}

async function mailIds(email: string): Promise<string[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
  return ((await res.json()) as { messages: { ID: string }[] }).messages.map((m) => m.ID)
}

/** The code from the first email to `email` that isn't in `seen`. */
async function newCode(email: string, seen: string[]): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const fresh = (await mailIds(email)).find((id) => !seen.includes(id))
    if (fresh) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${fresh}`)).json()
      const code = (msg.Text as string).match(/code[^0-9]*?(\d{6})\b/i)?.[1]
      if (code) return code
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`No new code email for ${email}`)
}

/** A user with one hunt, created through the API (the extension never creates accounts). */
async function userWithHunt(email: string) {
  const db = createClient(API, ANON, { auth: { persistSession: false } })
  const seen = await mailIds(email)
  await db.auth.signInWithOtp({ email })
  const { error } = await db.auth.verifyOtp({
    email,
    token: await newCode(email, seen),
    type: 'email',
  })
  if (error) throw error
  const { data: hunt, error: huntError } = await db.rpc('create_hunt', {
    p_name: 'Extension hunt',
    p_city: 'Warszawa',
  })
  if (huntError) throw huntError
  return { db, huntId: (hunt as { id: string }).id }
}

let context: BrowserContext
let id: string

test.beforeAll(async () => {
  // A copy with host access to the fixture's site: Playwright can't click the
  // toolbar button, which is what grants activeTab in real use.
  const dir = mkdtempSync(join(tmpdir(), 'at-ext-'))
  cpSync(dist, dir, { recursive: true })
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  manifest.host_permissions = [...(manifest.host_permissions ?? []), 'https://www.otodom.pl/*']
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))

  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  })
  await context.route('https://www.otodom.pl/**', (route) =>
    route.fulfill({ body: fixture, contentType: 'text/html; charset=utf-8' }),
  )
  id = extensionId(dir)
})

test.afterAll(async () => {
  await context?.close()
})

test('settings, code sign-in, and adding the open listing to a hunt', async () => {
  const email = `ext-${Date.now()}@test.local`
  const { db, huntId } = await userWithHunt(email)

  // Settings page: point the extension at the local stack.
  const options = await context.newPage()
  await options.goto(`chrome-extension://${id}/options.html`)
  await options.getByLabel('Supabase URL').fill(API)
  await options.getByLabel('Anon (public) key').fill(ANON)
  await options.getByLabel('Web app URL').fill(WEB_APP)
  await options.getByRole('button', { name: 'Save' }).click()
  await expect(options.getByTestId('saved')).toBeVisible()

  // The listing page the user is looking at.
  const listing = await context.newPage()
  await listing.goto(LISTING_URL)
  await expect(listing.getByRole('heading', { level: 1 })).toContainText('3 pokoje')

  // The popup, opened as a tab aimed at the listing tab.
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${id}/popup.html`)
  const tabId = await popup.evaluate(
    async (url) => (await chrome.tabs.query({ url }))[0]?.id,
    LISTING_URL,
  )
  const popupUrl = `chrome-extension://${id}/popup.html?tabId=${tabId}`
  await popup.goto(popupUrl)

  const seen = await mailIds(email)
  // Auth allows one email per user per second (config.toml max_frequency).
  await popup.waitForTimeout(1200)
  await popup.getByLabel('Email').fill(email)
  await popup.getByRole('button', { name: 'Email me a sign-in code' }).click()
  await expect(popup.getByLabel('Code')).toBeVisible()
  // Closing the popup to read the email doesn't lose the step.
  await popup.reload()
  await popup.getByLabel('Code').fill(await newCode(email, seen))
  await popup.getByRole('button', { name: 'Sign in' }).click()
  await expect(popup.getByTestId('signed-in-as')).toHaveText(email)
  await expect(popup.getByLabel('Hunt')).toHaveValue(huntId)

  const preview = popup.getByTestId('preview')
  await expect(preview).toContainText('3 pokoje, 64 m², Mokotów, blisko SKM Służewiec')
  await expect(preview).toContainText('5 430 zł')
  await expect(preview).toContainText('64,2 m²')
  await expect(preview).toContainText('Parsed 100%')

  await popup.getByRole('button', { name: 'Add this listing' }).click()
  const added = popup.getByTestId('added')
  await expect(added).toContainText('Added to the hunt.')
  const href = await added.getByRole('link', { name: 'Open in the app' }).getAttribute('href')
  const listingId = href?.match(new RegExp(`^${WEB_APP}#/h/${huntId}/l/([0-9a-f-]{36})$`))?.[1]
  expect(listingId).toBeTruthy()

  const { data: row } = await db
    .from('listings')
    .select('source, rent, area_m2, rooms, canonical_url')
    .eq('id', listingId!)
    .single()
  expect(row).toMatchObject({ source: 'otodom', rent: 4300, area_m2: 64.2, rooms: 3 })

  // Reopening: still signed in, same hunt remembered, and the dedup answer.
  await popup.goto(popupUrl)
  await expect(popup.getByLabel('Hunt')).toHaveValue(huntId)
  await popup.getByRole('button', { name: 'Add this listing' }).click()
  await expect(popup.getByTestId('added')).toContainText('Already in this hunt.')
})
