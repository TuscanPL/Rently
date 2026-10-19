import { expect, type Page } from '@playwright/test'

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'

export function uniqueEmail(name: string) {
  return `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`
}

/** Polls Mailpit for the newest email to `email` until `extract` finds something in its text. */
async function fromLatestEmail(email: string, extract: (text: string) => string | undefined) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    const { messages } = (await res.json()) as { messages: { ID: string }[] }
    if (messages.length > 0) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`)).json()
      const found = extract(msg.Text as string)
      if (found) return found
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`No matching email for ${email}`)
}

function fetchMagicLink(email: string): Promise<string> {
  return fromLatestEmail(email, (text) =>
    text
      .match(/https?:\/\/\S+\/auth\/v1\/verify\S+/)?.[0]
      ?.replace(/&amp;/g, '&')
      .replace(/\)$/, ''),
  )
}

/** The one-time code printed in the sign-in email (supabase/templates/magic_link.html). */
export function fetchSignInCode(email: string): Promise<string> {
  return fromLatestEmail(email, (text) => text.match(/code[^0-9]*?(\d{6})\b/i)?.[1])
}

/** Signs in through the real magic-link flow. Assumes the page is on the login screen. */
export async function signIn(page: Page, email: string) {
  await expect(page.getByLabel('Email')).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByTestId('link-sent')).toBeVisible()
  await page.goto(await fetchMagicLink(email))
}
