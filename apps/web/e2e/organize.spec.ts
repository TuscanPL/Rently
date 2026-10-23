import { readFile } from 'node:fs/promises'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { signIn, uniqueEmail } from './helpers'

// Milestone 4: criteria badges, list sort and filters, the pipeline with a booked
// viewing (.ics), viewing notes and live comments. Listings are added with the
// text-paste flow because listing sites are unreachable from CI.

// SCREENSHOTS=<dir> saves a picture of each screen for a visual check.
async function snap(page: Page, name: string) {
  if (process.env.SCREENSHOTS)
    await page.screenshot({ path: `${process.env.SCREENSHOTS}/${name}.png`, fullPage: true })
}

async function newHunt(page: Page, name: string) {
  await page.goto('/')
  await signIn(page, uniqueEmail('organizer'))
  await page.getByRole('link', { name: '+ New hunt' }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Create hunt' }).click()
  await expect(page.getByRole('heading', { name: 'Hunt settings' })).toBeVisible()
}

async function addListing(page: Page, text: string, district: string, agency = false) {
  await page.getByRole('link', { name: 'List' }).click()
  await page.getByTestId('add-button').click()
  await page.getByRole('tab', { name: 'Text + photos' }).click()
  await page.getByLabel('Post text').fill(text)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('District').fill(district)
  if (agency) await page.getByLabel('Advertiser').selectOption('agency')
  await page.getByRole('button', { name: 'Save listing' }).click()
  await expect(page.getByTestId('costs')).toBeVisible()
}

async function withPartner(browser: Browser, a: Page) {
  await a.getByRole('link', { name: 'Settings' }).click()
  await a.getByRole('button', { name: 'Create invite link' }).click()
  const inviteUrl = await a.getByTestId('invite-url').first().inputValue()
  const b = await (await browser.newContext()).newPage()
  await b.goto(inviteUrl)
  await signIn(b, uniqueEmail('partner'))
  await b.getByRole('button', { name: 'Join hunt' }).click()
  await expect(b.getByTestId('deck-card')).toBeVisible()
  return b
}

test('criteria badges, list sort and filters, pipeline, viewing note and live comments', async ({
  browser,
  page,
}) => {
  await newHunt(page, 'Organize hunt')

  // Criteria: budget, rooms, private landlords only.
  const criteria = page.getByTestId('criteria')
  await criteria.getByLabel('Max per month').fill('5000')
  await criteria.getByLabel('Min rooms').fill('3')
  await criteria.getByLabel('Allowed districts').fill('Mokotów')
  await criteria.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(criteria.getByTestId('district-chip')).toHaveText(/Mokotów/)
  await criteria.getByLabel('Private landlord').check()
  await criteria.getByRole('button', { name: 'Save' }).click()
  await expect(criteria.getByText('Saved')).toBeVisible()
  await snap(page, 'criteria')

  await addListing(
    page,
    'Big flat by the park\n3 pokoje, 62 m2. Cena: 4200 zł + czynsz administracyjny 750 zł.',
    'Mokotów',
  )
  await expect(page.getByTestId('detail-criteria').getByTestId('criteria-badge')).toHaveCount(0)
  await addListing(
    page,
    'Small pricey flat\n2 pokoje, 45 m2. Cena: 5000 zł + czynsz administracyjny 400 zł.',
    'Wola',
    true,
  )
  const detailBadges = page.getByTestId('detail-criteria').getByTestId('criteria-badge')
  await expect(detailBadges).toHaveText([
    'Over budget +400 zł',
    '2 rooms < 3',
    'Wola: outside your districts',
    'Agency',
  ])

  // List: badges on the card, newest first, then sorted by total cost.
  await page.getByRole('link', { name: 'List' }).click()
  const cards = page.getByTestId('listing-card')
  await expect(cards).toHaveCount(2)
  await expect(cards.nth(0)).toContainText('Small pricey flat')
  await expect(cards.nth(0).getByTestId('criteria-badge')).toHaveCount(4)
  await expect(cards.nth(0)).toContainText('Over budget +400 zł')
  await page.getByTestId('list-sort').selectOption('total')
  await expect(cards.nth(0)).toContainText('Big flat by the park')
  await expect(cards.nth(0)).toContainText('4 950 zł')

  await page.getByRole('button', { name: 'Filters' }).click()
  await page.getByLabel('Hide listings that break criteria').check()
  await expect(cards).toHaveCount(1)
  await expect(page.getByTestId('list-count')).toHaveText('Showing 1 of 2')
  await page.getByRole('button', { name: 'Done' }).click()
  await snap(page, 'list-filtered')

  // The choice survives a reload (per hunt, on this device).
  await page.reload()
  await expect(page.getByTestId('list-count')).toHaveText('Showing 1 of 2')
  await expect(page.getByTestId('list-sort')).toHaveValue('total')
  await page.getByRole('button', { name: 'Filters (1)' }).click()
  await page.getByRole('button', { name: 'Reset filters' }).click()
  await expect(cards).toHaveCount(2)
  await page.getByRole('button', { name: 'Done' }).click()
  await snap(page, 'list')

  // The deck card carries the same badges.
  await page.getByRole('link', { name: 'Deck' }).click()
  const deckCard = page.getByTestId('deck-card')
  await expect(deckCard).toContainText('Small pricey flat')
  await expect(deckCard.getByTestId('criteria-badge').first()).toHaveText('Over budget +400 zł')
  await snap(page, 'deck-badges')

  const b = await withPartner(browser, page)

  // Pipeline: book a viewing with a time and download it as .ics.
  await page.getByRole('link', { name: 'Pipeline' }).click()
  const pipeline = page.getByTestId('pipeline')
  await expect(pipeline.getByTestId('column-new').getByTestId('pipeline-card')).toHaveCount(2)
  await pipeline.getByRole('button', { name: /Big flat by the park/ }).click()
  const sheet = page.getByTestId('status-sheet')
  await sheet.getByRole('button', { name: 'Viewing booked' }).click()
  await sheet.getByLabel('Date and time').fill('2026-11-12T18:00')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toContainText('Viewing Thu, Nov 12, 18:00')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    sheet.getByRole('button', { name: 'Add to calendar (.ics)' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^viewing-.*\.ics$/)
  const ics = await readFile((await download.path())!, 'utf8')
  expect(ics).toContain('BEGIN:VEVENT')
  expect(ics).toContain('DTSTART;TZID=Europe/Warsaw:20261112T180000')
  expect(ics).toContain('DTEND;TZID=Europe/Warsaw:20261112T190000')
  expect(ics).toContain('SUMMARY:Viewing: Big flat by the park')
  expect(ics).toContain('LOCATION:Mokotów')
  expect(ics.replace(/\r\n /g, '')).toMatch(/URL:http:\/\/localhost:\d+\/#\/h\/[\w-]+\/l\/[\w-]+/)
  await sheet.getByRole('button', { name: 'Done' }).click()

  const booked = pipeline.getByTestId('column-viewing_booked').getByTestId('pipeline-card')
  await expect(booked).toContainText('Big flat by the park')
  await expect(booked.getByTestId('viewing-at')).toContainText('Nov 12, 18:00')
  await snap(page, 'pipeline')

  // Viewed: each member is nudged for a viewing note.
  await booked.getByRole('button', { name: /Big flat by the park/ }).click()
  await sheet.getByRole('button', { name: 'Viewed' }).click()
  const viewed = pipeline.getByTestId('column-viewed').getByTestId('pipeline-card')
  await expect(viewed).toContainText('Big flat by the park')
  await expect(viewed.getByTestId('note-pending')).toBeVisible()
  await snap(page, 'pipeline-viewed')

  // The partner opens the same listing and waits on its thread.
  await b.getByRole('link', { name: 'Pipeline' }).click()
  await expect(b.getByTestId('column-viewed').getByTestId('note-pending')).toBeVisible()
  await b.getByTestId('column-viewed').getByTestId('note-pending').click()
  await expect(b.getByTestId('viewing-note-form')).toBeVisible()

  await viewed.getByTestId('note-pending').click()
  const form = page.getByTestId('viewing-note-form')
  await form.getByRole('group', { name: 'Smell' }).getByRole('button', { name: 'Good' }).click()
  await form.getByRole('group', { name: 'Light' }).getByRole('button', { name: 'Good' }).click()
  await form.getByRole('group', { name: 'Noise' }).getByRole('button', { name: 'Bad' }).click()
  await form
    .getByRole('group', { name: 'Landlord vibe' })
    .getByRole('button', { name: 'OK' })
    .click()
  await form.getByLabel('Anything else?').fill('Trams under the bedroom window')
  await snap(page, 'viewing-note-form')
  await form.getByRole('button', { name: 'Save note' }).click()

  const note = page.locator('[data-testid="comment"][data-kind="viewing_note"]')
  await expect(note).toContainText('Viewing note')
  await expect(note).toContainText('Trams under the bedroom window')
  await expect(note.getByTestId('note-ratings')).toContainText('Noise: 👎 Bad')
  await expect(note.getByTestId('note-ratings')).toContainText('Landlord vibe: 😐 OK')
  await expect(page.getByTestId('viewing-note-form')).toBeHidden()

  // The partner sees the note and a new comment arrive live.
  const bThread = b.getByTestId('comment-list')
  await expect(bThread.locator('[data-kind="viewing_note"]')).toContainText('Trams under')
  await page.getByLabel('Comment', { exact: true }).fill('Shall we apply?')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByTestId('comment-list')).toContainText('Shall we apply?')
  await expect(bThread.locator('[data-kind="comment"]')).toContainText('Shall we apply?')

  // Status is editable here too, and the history records the moves.
  await expect(page.getByTestId('listing-status')).toContainText('Viewed')
  await expect(page.getByText(/moved it to Viewed/)).toBeVisible()
  await expect(page.getByText(/added a viewing note/)).toBeVisible()
  await snap(page, 'detail-thread')
  await page.getByTestId('listing-status').getByRole('button', { name: 'Change status' }).click()
  await sheet.getByRole('button', { name: 'Applied' }).click()
  await expect(page.getByTestId('listing-status')).toContainText('Applied')
  await expect(page.getByText(/moved it to Applied/)).toBeVisible()
})

test('drag a card between pipeline stages on a desktop', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  await newHunt(page, 'Desktop hunt')
  await addListing(page, 'Corner flat\n3 pokoje, 70 m2. Cena: 4500 zł.', 'Ochota')
  await addListing(page, 'Attic flat\n2 pokoje, 40 m2. Cena: 3300 zł.', 'Wola')
  await page.getByRole('link', { name: 'List' }).click()
  await expect(page.getByTestId('listing-card')).toHaveCount(2)
  await snap(page, 'list-desktop')

  await page.getByRole('link', { name: 'Pipeline' }).click()
  const card = page.getByTestId('pipeline-card').filter({ hasText: 'Corner flat' })
  await card.dragTo(page.getByTestId('column-contacted'))
  await expect(page.getByTestId('column-contacted').getByTestId('pipeline-card')).toContainText(
    'Corner flat',
  )

  // Dropping on "Viewing booked" asks for the time first.
  await page
    .getByTestId('pipeline-card')
    .filter({ hasText: 'Attic flat' })
    .dragTo(page.getByTestId('column-viewing_booked'))
  await page.getByLabel('Date and time').fill('2026-12-01T09:30')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(
    page.getByTestId('column-viewing_booked').getByTestId('pipeline-card'),
  ).toContainText('Attic flat')
  await snap(page, 'pipeline-desktop')

  await page.getByRole('link', { name: 'List' }).click()
  await expect(
    page.getByTestId('listing-card').filter({ hasText: 'Corner flat' }).getByTestId('status-pill'),
  ).toHaveText('Contacted')
  await page.getByTestId('listing-card').filter({ hasText: 'Corner flat' }).click()
  await expect(page.getByText(/moved it to Contacted/)).toBeVisible()
  await snap(page, 'detail-desktop')
  await page.getByRole('link', { name: 'Settings' }).click()
  await snap(page, 'settings-desktop')
})

test('drag a card down to another pipeline stage with a finger', async ({ page }) => {
  await newHunt(page, 'Touch hunt')
  await addListing(page, 'Corner flat\n3 pokoje, 70 m2. Cena: 4500 zł.', 'Ochota')
  await page.getByRole('link', { name: 'Pipeline' }).click()

  const handle = page
    .getByTestId('pipeline-card')
    .filter({ hasText: 'Corner flat' })
    .getByTestId('drag-handle')
  const from = (await handle.boundingBox())!
  const to = (await page.getByTestId('column-applied').boundingBox())!
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 }

  // Real touch events (pointerType "touch"), as a phone sends them.
  const cdp = await page.context().newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [p] : [] })
  await touch('touchStart', start)
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', {
      x: start.x + ((end.x - start.x) * i) / 10,
      y: start.y + ((end.y - start.y) * i) / 10,
    })
  }
  await expect(page.getByTestId('column-applied')).toHaveClass(/ring-brand-500/)
  await touch('touchEnd')

  await expect(page.getByTestId('column-applied').getByTestId('pipeline-card')).toContainText(
    'Corner flat',
  )
  await expect(page.getByTestId('column-new').getByTestId('pipeline-card')).toHaveCount(0)
  // The drag must not also open the status sheet.
  await expect(page.getByRole('dialog')).toBeHidden()
  await snap(page, 'pipeline-touch')
})
