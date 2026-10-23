import { expect, test, type Browser, type Page } from '@playwright/test'
import { signIn, uniqueEmail } from './helpers'

// Milestone 6: the share target (signed out → login → add flow) and the in-app
// notification feed. Real Web Push needs a push service, which headless Chromium
// doesn't have; the encryption and the service worker's payload handling are
// unit-tested (packages/edge/src/webpush.test.ts, apps/web/src/lib/sw-message.test.ts).

const MORIZON = 'https://www.morizon.pl/oferta/wynajem-mieszkanie-warszawa-mokotow-52m2-mzn2077123'
const OLX = 'https://www.olx.pl/d/oferta/mieszkanie-2-pokoje-ochota-CID3-ID19xYz.html'

async function newHunt(page: Page, name: string) {
  await page.getByRole('link', { name: '+ New hunt' }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Create hunt' }).click()
  await expect(page.getByRole('heading', { name: 'Hunt settings' })).toBeVisible()
}

async function signOut(page: Page) {
  await page.goto('/#/account')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByLabel('Email')).toBeVisible()
}

test('a link shared while signed out lands in the add flow after sign-in', async ({ page }) => {
  const email = uniqueEmail('sharer')
  await page.goto('/')
  await signIn(page, email)
  await newHunt(page, 'Share hunt')
  await signOut(page)

  // What Android's share sheet opens: the params in the real query string.
  await page.goto(`/?title=Mieszkanie&url=${encodeURIComponent(MORIZON)}#/add`)
  await expect(page.getByLabel('Email')).toBeVisible()
  await signIn(page, email)

  // One hunt: no picker, straight into its add flow with the link filled in.
  await expect(page.getByLabel('Listing link')).toHaveValue(MORIZON)
  expect(new URL(page.url()).search).toBe('')
  await page.getByRole('button', { name: 'Add listing' }).click()
  await expect(
    page.getByRole('heading', { name: 'Wynajem mieszkanie warszawa mokotow 52m2 mzn2077123' }),
  ).toBeVisible()
})

test('shared text with a link: pick the hunt, last opened preselected', async ({ page }) => {
  const email = uniqueEmail('texter')
  await page.goto('/')
  await signIn(page, email)
  await newHunt(page, 'First hunt')
  await page.goto('/#/hunts')
  await newHunt(page, 'Second hunt')
  await signOut(page)

  const text = `Zobacz to mieszkanie! ${OLX}`
  await page.goto(`/?text=${encodeURIComponent(text)}#/add`)
  await signIn(page, email)

  await expect(page.getByTestId('shared-preview')).toContainText(OLX)
  expect(new URL(page.url()).search).toBe('')
  await expect(page.getByRole('radio', { name: /Second hunt/ })).toBeChecked()
  await page.getByRole('radio', { name: /First hunt/ }).check()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByLabel('Listing link')).toHaveValue(OLX)
  await page.getByRole('button', { name: 'Add listing' }).click()
  await expect(page.getByTestId('needs-details')).toBeVisible()
  await page.getByRole('link', { name: 'All hunts' }).click()
  await page.getByRole('link', { name: /First hunt/ }).click()
  await page.getByRole('link', { name: 'List', exact: true }).click()
  await expect(page.getByTestId('listing-card')).toHaveCount(1)
})

async function huntWithPartner(browser: Browser) {
  const aEmail = uniqueEmail('ala')
  const bEmail = uniqueEmail('bartek')
  const a = await (await browser.newContext()).newPage()
  const b = await (await browser.newContext()).newPage()

  await a.goto('/')
  await signIn(a, aEmail)
  await newHunt(a, 'Feed hunt')
  await a.getByRole('button', { name: 'Create invite link' }).click()
  const inviteUrl = await a.getByTestId('invite-url').first().inputValue()

  await b.goto(inviteUrl)
  await signIn(b, bEmail)
  await b.getByRole('button', { name: 'Join hunt' }).click()
  await expect(b.getByTestId('deck-empty')).toBeVisible()
  return { a, b, aName: aEmail.split('@')[0]!, bName: bEmail.split('@')[0]! }
}

async function addListing(page: Page, title: string) {
  await page.getByRole('link', { name: 'Deck' }).click()
  await page.getByTestId('deck-add').click()
  await page.getByRole('tab', { name: 'Text + photos' }).click()
  await page.getByLabel('Post text').fill(`${title}\n2 pokoje, 48 m2. Cena: 3900 zł.`)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Save listing' }).click()
  await expect(page.getByTestId('costs')).toBeVisible()
  await page.getByRole('link', { name: 'Deck' }).click()
}

const swipeYes = (page: Page) =>
  page.getByTestId('deck-controls').getByRole('button', { name: 'Yes', exact: true }).click()

test('partners see new listings and matches in their notification feed, live', async ({
  browser,
}) => {
  const { a, b, aName } = await huntWithPartner(browser)
  await expect(b.getByTestId('notification-bell')).toBeVisible()
  await expect(b.getByTestId('unread-count')).toBeHidden()

  await addListing(a, 'Flat with a view')
  // The adder isn't notified about their own listing; the partner is, over Realtime.
  await expect(b.getByTestId('unread-count')).toHaveText('1')
  await expect(a.getByTestId('unread-count')).toBeHidden()

  await b.getByTestId('notification-bell').click()
  const feed = b.getByTestId('notification-feed')
  await expect(feed.getByTestId('notification')).toHaveCount(1)
  await expect(feed).toContainText(`${aName} added Flat with a view`)

  // A swipes yes; B's yes completes the match, so A (not B) gets a match notification.
  await swipeYes(a)
  await b.getByTestId('notification').click()
  await expect(b.getByRole('heading', { name: 'Flat with a view' })).toBeVisible()
  await expect(b.getByTestId('unread-count')).toBeHidden()
  await b.getByRole('link', { name: 'Deck' }).click()
  await swipeYes(b)

  await expect(a.getByTestId('unread-count')).toHaveText('1')
  await a.getByTestId('notification-bell').click()
  await expect(a.getByTestId('notification-feed')).toContainText(
    "It's a match: everyone said yes to Flat with a view",
  )
  await a.getByRole('button', { name: 'Mark all read' }).click()
  await expect(a.getByTestId('unread-count')).toBeHidden()

  // B's feed has no match row: B's own vote made it.
  await b.getByTestId('notification-bell').click()
  await expect(b.getByTestId('notification')).toHaveCount(1)
})

test('notification switches are saved per user', async ({ page }) => {
  await page.goto('/')
  await signIn(page, uniqueEmail('prefs'))
  await page.getByRole('link', { name: 'Account' }).click()
  const settings = page.getByTestId('notification-settings')
  const added = settings.getByRole('switch', { name: 'Listings a partner adds' })
  await expect(added).toBeChecked()
  await added.uncheck()
  await expect(added).not.toBeChecked()

  await page.reload()
  await expect(added).not.toBeChecked()
  await expect(settings.getByRole('switch', { name: 'New matches' })).toBeChecked()
  // `pnpm dev` registers no service worker, but the push section still explains itself.
  await expect(settings.getByTestId('push-status')).not.toBeEmpty()
})
