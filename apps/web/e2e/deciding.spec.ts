import { expect, test, type Browser, type Page } from '@playwright/test'
import { signIn, uniqueEmail } from './helpers'

// Two members in one hunt, each in their own browser context. Listings are added
// with the text-paste flow because listing sites are unreachable from CI.

async function huntWithPartner(browser: Browser) {
  const aEmail = uniqueEmail('ala')
  const bEmail = uniqueEmail('bartek')
  const a = await (await browser.newContext()).newPage()
  const b = await (await browser.newContext()).newPage()

  await a.goto('/')
  await signIn(a, aEmail)
  await a.getByRole('link', { name: '+ New hunt' }).click()
  await a.getByLabel('Name').fill('Deciding hunt')
  await a.getByRole('button', { name: 'Create hunt' }).click()
  await a.getByRole('button', { name: 'Create invite link' }).click()
  const inviteUrl = await a.getByTestId('invite-url').first().inputValue()

  await b.goto(inviteUrl)
  await signIn(b, bEmail)
  await b.getByRole('button', { name: 'Join hunt' }).click()
  await expect(b.getByTestId('deck-empty')).toBeVisible()

  return { a, b, aName: aEmail.split('@')[0]!, bName: bEmail.split('@')[0]! }
}

async function addListing(page: Page, title: string, rent: number, total: string) {
  await page.getByRole('link', { name: 'Deck' }).click()
  await page.getByTestId('deck-add').click()
  await page.getByRole('tab', { name: 'Text + photos' }).click()
  await page
    .getByLabel('Post text')
    .fill(`${title}\n3 pokoje, 62 m2. Cena: ${rent} zł + czynsz administracyjny 750 zł.`)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('District').fill('Mokotów')
  await page.getByRole('button', { name: 'Save listing' }).click()
  await expect(page.getByTestId('costs')).toContainText(total)
  await page.getByRole('link', { name: 'Deck' }).click()
}

const swipe = (page: Page, name: 'Yes' | 'No' | 'Maybe') =>
  page.getByTestId('deck-controls').getByRole('button', { name, exact: true }).click()

test('both members swipe yes and both see the match', async ({ browser }) => {
  const { a, b } = await huntWithPartner(browser)
  await addListing(a, 'Sunny flat near SKM', 4200, '4 950 zł')

  await expect(a.getByTestId('deck-card')).toContainText('Sunny flat near SKM')
  await expect(a.getByTestId('deck-card')).toContainText('4 950 zł')
  await swipe(a, 'Yes')
  await expect(a.getByTestId('deck-empty')).toBeVisible()

  // Undo brings the card back; swipe again.
  await a.getByRole('button', { name: 'Undo last swipe' }).click()
  await expect(a.getByTestId('deck-card')).toContainText('Sunny flat near SKM')
  await swipe(a, 'Yes')
  await expect(a.getByTestId('deck-empty')).toBeVisible()

  // The new listing reaches B's deck over Realtime.
  await expect(b.getByTestId('deck-card')).toContainText('Sunny flat near SKM')
  await b.getByTestId('deck-card').getByRole('button', { name: '4 stars' }).click()
  await swipe(b, 'Yes')

  // B's yes completes the match: A gets the toast from Realtime.
  await expect(a.getByTestId('match-toast')).toContainText("It's a match")
  await expect(a.getByTestId('match-toast')).toContainText('Sunny flat near SKM')
  await expect(b.getByTestId('match-toast')).toContainText("It's a match")

  for (const page of [a, b]) {
    await page.getByRole('link', { name: /^Matches/ }).click()
    await expect(page.getByTestId('matches-list').getByTestId('listing-card')).toContainText(
      'Sunny flat near SKM',
    )
  }
  await expect(b.getByTestId('combined-score')).toContainText('Score 5')
})

test('a rejected listing comes back to the top of the deck after Reconsider', async ({
  browser,
}) => {
  const { a, b, aName, bName } = await huntWithPartner(browser)
  await addListing(a, 'Flat with a small kitchen', 3800, '4 550 zł')
  await addListing(a, 'Flat by the park', 4600, '5 350 zł')

  // B says no to the kitchen flat (the older one, second in the deck).
  await expect(b.getByTestId('deck-card')).toContainText('Flat by the park')
  await swipe(b, 'Maybe')
  await expect(b.getByTestId('deck-card')).toContainText('Flat with a small kitchen')
  await swipe(b, 'No')
  await expect(b.getByTestId('deck-empty')).toBeVisible()

  // A sees the rejected listing after the unrejected one, with the banner.
  await expect(a.getByTestId('deck-card')).toContainText('Flat by the park')
  await swipe(a, 'Yes')
  const card = a.getByTestId('deck-card')
  await expect(card).toContainText('Flat with a small kitchen')
  await expect(card.getByTestId('rejected-banner')).toContainText(`✗ Rejected by ${bName}`)

  await card.getByRole('button', { name: 'Reconsider' }).click()
  await a.getByLabel('Note (optional)').fill('price dropped')
  await a.getByRole('dialog').getByRole('button', { name: 'Reconsider' }).click()
  await expect(card.getByTestId('rejected-banner')).toContainText('Reconsider requested')
  await swipe(a, 'Yes')

  // Back at the top of B's deck, with who asked and the note.
  const pinned = b.getByTestId('deck-card')
  await expect(pinned).toContainText('Flat with a small kitchen')
  await expect(pinned.getByTestId('reconsider-banner')).toContainText(
    `${aName} asks you to take another look`,
  )
  await expect(pinned.getByTestId('reconsider-banner')).toContainText('price dropped')

  await swipe(b, 'Yes')
  await expect(b.getByTestId('match-toast')).toContainText("It's a match")
  await expect(a.getByTestId('match-toast')).toContainText('Flat with a small kitchen')

  await a.getByRole('link', { name: /^Matches/ }).click()
  await expect(a.getByTestId('matches-list')).toContainText('Flat with a small kitchen')
  await a.getByRole('link', { name: /^Maybes/ }).click()
  await expect(a.getByTestId('maybes-list')).toContainText('Flat by the park')
})
