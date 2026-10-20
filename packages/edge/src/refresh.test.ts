import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@at/shared/database'
import { createRefreshHandler, type RefreshEnv } from './index.ts'
import { classifyLanding, hasGoneMarker } from './refresh.ts'

// Integration test against the local stack (`supabase start`); skipped when it isn't running.
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const CRON_SECRET = 'test-cron-secret'

const stackUp = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: ANON_KEY } })
  .then((r) => r.ok)
  .catch(() => false)

const OTODOM_AD = readFileSync(
  new URL('../../parsers/__fixtures__/otodom-ad.html', import.meta.url),
  'utf8',
)
const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })

describe('classifyLanding', () => {
  it('tells ad pages from index pages', () => {
    const c = (u: string) => classifyLanding(new URL(u))
    expect(c('https://www.otodom.pl/pl/oferta/x-ID1')).toBe('ad')
    expect(c('https://www.otodom.pl/pl/wyniki/wynajem/mieszkanie/mazowieckie/warszawa')).toBe(
      'index',
    )
    expect(c('https://www.olx.pl/d/oferta/x-CID3-IDabc.html')).toBe('ad')
    expect(c('https://www.olx.pl/nieruchomosci/mieszkania/wynajem/warszawa/')).toBe('index')
    expect(c('https://gratka.pl/nieruchomosci/x/ob/38123456')).toBe('ad')
    expect(c('https://gratka.pl/nieruchomosci/mieszkania/warszawa/wynajem')).toBe('index')
    expect(c('https://warszawa.nieruchomosci-online.pl/mieszkanie,na-wynajem/25123456.html')).toBe(
      'ad',
    )
    expect(c('https://www.domiporta.pl/nieruchomosci/wynajme-mieszkanie/154123456')).toBe('ad')
    expect(c('https://www.domiporta.pl/mieszkanie/wynajme/warszawa')).toBe('index')
    expect(c('https://example.com/')).toBe('index')
    expect(c('https://example.com/flat/7')).toBe('unclear')
  })

  it('spots expired-ad notices', () => {
    expect(hasGoneMarker('To ogłoszenie jest już nieaktualne')).toBe(true)
    expect(hasGoneMarker('Ogłoszenie wygasło 3 dni temu')).toBe(true)
    expect(hasGoneMarker('Oferta zakończona')).toBe(true)
    expect(hasGoneMarker('To ogłoszenie nie jest już dostępne')).toBe(true)
    expect(hasGoneMarker('Mieszkanie 3 pokoje, ogłoszenie aktualne')).toBe(false)
  })
})

describe.skipIf(!stackUp)('refresh-listings', () => {
  const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })
  // Unique hosts per run: fetch slots live in the database between runs.
  const tag = `t${Date.now().toString(36)}`
  let routes = new Map<string, () => Response>()
  let fetches: { url: string; at: number }[] = []

  async function fakeFetch(input: RequestInfo | URL): Promise<Response> {
    const url = input.toString()
    fetches.push({ url, at: Date.now() })
    return routes.get(url)?.() ?? new Response('Forbidden', { status: 403 })
  }

  const env: RefreshEnv = {
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    serviceRoleKey: SERVICE_KEY,
    cronSecret: CRON_SECRET,
    fetchExternal: fakeFetch as typeof fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    domainIntervalMs: 300,
  }
  const handler = createRefreshHandler(env)

  const cron = async (handle = handler, secret: string | null = CRON_SECRET) => {
    const res = await handle(
      new Request('http://localhost/refresh-listings', {
        method: 'POST',
        headers: secret == null ? {} : { 'x-cron-secret': secret },
      }),
    )
    return { status: res.status, body: await res.json() }
  }

  let huntId = ''
  let userId = ''
  let token = ''
  let strangerToken = ''

  async function signUp(name: string) {
    const email = `${name}-${Date.now()}@test.local`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'password123',
      email_confirm: true,
    })
    if (error) throw error
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
    })
    const { data: session, error: signInError } = await client.auth.signInWithPassword({
      email,
      password: 'password123',
    })
    if (signInError) throw signInError
    const { data: hunt, error: huntError } = await client.rpc('create_hunt', { p_name: name })
    if (huntError) throw huntError
    return { id: data.user.id, token: session.session!.access_token, huntId: hunt.id }
  }

  beforeAll(async () => {
    const me = await signUp('refresh')
    const stranger = await signUp('stranger')
    ;({ id: userId, token, huntId } = me)
    ;({ token: strangerToken } = stranger)
  })

  // Other tests' listings would be due too: mark everything as just checked.
  beforeEach(async () => {
    routes = new Map()
    fetches = []
    const { error } = await admin
      .from('listings')
      .update({ last_checked_at: new Date().toISOString() })
      .not('id', 'is', null)
    if (error) throw error
  })

  type ListingInsert = Database['public']['Tables']['listings']['Insert']
  async function addListing(url: string, fields: Partial<ListingInsert> = {}) {
    const { data, error } = await admin
      .from('listings')
      .insert({ hunt_id: huntId, added_by: userId, url, title: 'Flat', ...fields })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }
  const getListing = async (id: string) =>
    (await admin.from('listings').select('*').eq('id', id).single()).data!
  const eventsOf = async (id: string) =>
    (
      await admin
        .from('listing_events')
        .select('type, payload, user_id')
        .eq('listing_id', id)
        .order('created_at')
    ).data!

  it('refuses calls without the secret or a user', async () => {
    expect((await cron(handler, null)).status).toBe(401)
    expect((await cron(handler, 'wrong')).status).toBe(401)
    expect((await cron(createRefreshHandler({ ...env, cronSecret: undefined }), '')).status).toBe(
      401,
    )
  })

  it('answers with an empty summary when nothing is due (the keep-alive ping)', async () => {
    const { status, body } = await cron()
    expect(status).toBe(200)
    expect(body).toEqual({
      checked: 0,
      unchanged: 0,
      priceChanged: 0,
      removed: 0,
      restored: 0,
      unknown: 0,
      remaining: 0,
    })
  })

  it('records a price drop without touching fields the user edited', async () => {
    const url = `https://${tag}-a.otodom.pl/pl/oferta/3-pokoje-ID4tAbC`
    routes.set(url, () => html(OTODOM_AD))
    const id = await addListing(url, {
      title: 'Our favourite',
      rent: 4500,
      admin_fee: 780,
      area_m2: 70,
    })

    const { body } = await cron()
    expect(body).toMatchObject({ checked: 1, priceChanged: 1, unknown: 0, remaining: 0 })

    const listing = await getListing(id)
    expect(listing).toMatchObject({
      rent: 4300,
      admin_fee: 780,
      title: 'Our favourite',
      area_m2: 70,
      is_active: true,
    })
    expect(listing.last_checked_at).not.toBeNull()
    const { data: history } = await admin
      .from('listing_price_history')
      .select('rent, admin_fee')
      .eq('listing_id', id)
      .order('observed_at')
    expect(history).toEqual([
      { rent: 4500, admin_fee: 780 },
      { rent: 4300, admin_fee: 780 },
    ])
    expect(await eventsOf(id)).toEqual([
      {
        type: 'price_changed',
        user_id: null,
        payload: {
          hunt_id: huntId,
          rent_before: 4500,
          rent_after: 4300,
          admin_fee_before: 780,
          admin_fee_after: 780,
        },
      },
    ])

    // Checked again tomorrow at the same price: nothing new.
    await admin.from('listings').update({ last_checked_at: '2020-01-01T00:00:00Z' }).eq('id', id)
    expect((await cron()).body).toMatchObject({ checked: 1, unchanged: 1 })
    expect(await eventsOf(id)).toHaveLength(1)
  })

  it('marks a 404 ad as removed and keeps the snapshot', async () => {
    const url = `https://${tag}-b.olx.pl/d/oferta/flat-CID3-IDgone.html`
    routes.set(url, () => html('Not found', 404))
    const id = await addListing(url, { rent: 3000 })

    expect((await cron()).body).toMatchObject({ checked: 1, removed: 1 })
    expect(await getListing(id)).toMatchObject({ is_active: false, title: 'Flat', rent: 3000 })
    expect(await eventsOf(id)).toEqual([
      { type: 'ad_removed', user_id: null, payload: { hunt_id: huntId } },
    ])
  })

  it('never marks an ad gone on a 403, a 5xx, a bot wall or a network error', async () => {
    const urls = [
      `https://${tag}-c.otodom.pl/pl/oferta/forbidden-ID1`,
      `https://${tag}-c2.otodom.pl/pl/oferta/broken-ID2`,
      `https://${tag}-c3.otodom.pl/pl/oferta/wall-ID3`,
      `https://${tag}-c4.otodom.pl/pl/oferta/offline-ID4`,
    ]
    routes.set(urls[0]!, () => new Response('Forbidden', { status: 403 }))
    routes.set(urls[1]!, () => html('Oops', 503))
    routes.set(urls[2]!, () => html('<title>Just a moment...</title><p>Checking your browser</p>'))
    routes.set(urls[3]!, () => {
      throw new TypeError('fetch failed')
    })
    const ids = await Promise.all(urls.map((u) => addListing(u, { rent: 3000 })))

    expect((await cron()).body).toMatchObject({ checked: 4, unknown: 4, removed: 0 })
    for (const id of ids) {
      const listing = await getListing(id)
      expect(listing.is_active).toBe(true)
      expect(listing.last_checked_at).not.toBeNull()
      expect(await eventsOf(id)).toEqual([])
    }
  })

  it('treats a redirect to a search page or an expired notice as gone', async () => {
    const redirected = `https://${tag}-d.otodom.pl/pl/oferta/old-ID5`
    routes.set(
      redirected,
      () =>
        new Response(null, {
          status: 301,
          headers: { location: '/pl/wyniki/wynajem/mieszkanie/mazowieckie/warszawa' },
        }),
    )
    const expired = `https://${tag}-d2.gratka.pl/nieruchomosci/x/ob/123`
    routes.set(expired, () =>
      html('<h1>Mieszkanie</h1><div class="alert">To ogłoszenie jest już nieaktualne</div>'),
    )
    const a = await addListing(redirected, { rent: 3000 })
    const b = await addListing(expired, { rent: 3000 })

    expect((await cron()).body).toMatchObject({ checked: 2, removed: 2 })
    expect((await getListing(a)).is_active).toBe(false)
    expect((await getListing(b)).is_active).toBe(false)
  })

  it('follows a redirect to the ad itself (OLX → Otodom)', async () => {
    const olx = `https://${tag}-e.olx.pl/d/oferta/flat-CID3-IDx.html`
    const otodom = `https://${tag}-e.otodom.pl/pl/oferta/3-pokoje-ID4tAbC`
    routes.set(olx, () => new Response(null, { status: 302, headers: { location: otodom } }))
    routes.set(otodom, () => html(OTODOM_AD))
    const id = await addListing(olx, { rent: 4300, admin_fee: 780 })

    expect((await cron()).body).toMatchObject({ checked: 1, unchanged: 1 })
    expect((await getListing(id)).is_active).toBe(true)
  })

  it('reactivates an ad that came back', async () => {
    const url = `https://${tag}-f.otodom.pl/pl/oferta/3-pokoje-ID4tAbC`
    routes.set(url, () => html(OTODOM_AD))
    const id = await addListing(url, {
      rent: 4300,
      admin_fee: 780,
      is_active: false,
      last_checked_at: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    })

    expect((await cron()).body).toMatchObject({ checked: 1, restored: 1 })
    expect((await getListing(id)).is_active).toBe(true)
    expect(await eventsOf(id)).toEqual([
      { type: 'ad_restored', user_id: null, payload: { hunt_id: huntId } },
    ])
  })

  it('stops starting fetches when the time budget runs out and reports what is left', async () => {
    const urls = Array.from({ length: 7 }, (_, i) => `https://${tag}-g.olx.pl/d/oferta/f-ID${i}`)
    for (const u of urls) {
      routes.set(u, () => html('Forbidden', 403))
      await addListing(u)
    }
    const handle = createRefreshHandler({ ...env, batchSize: 6, timeBudgetMs: 1000 })

    // Slots at ~0, 300, 600 and 900 ms fit the budget; the next one wouldn't.
    const { body } = await cron(handle)
    expect(body).toMatchObject({ checked: 4, remaining: 3 })
    expect(fetches).toHaveLength(4)

    // The next call picks up the rest.
    expect((await cron()).body).toMatchObject({ checked: 3, remaining: 0 })
  })

  it('spaces requests to one domain while other domains go in between', async () => {
    const a = [1, 2].map((i) => `https://${tag}-h.olx.pl/d/oferta/a-ID${i}`)
    const b = [1, 2].map((i) => `https://${tag}-h.otodom.pl/pl/oferta/b-ID${i}`)
    for (const u of [...a, ...b]) await addListing(u)

    expect((await cron()).body).toMatchObject({ checked: 4 })
    const at = (u: string) => fetches.find((f) => f.url === u)!.at
    expect(at(a[1]!) - at(a[0]!)).toBeGreaterThanOrEqual(250)
    expect(at(b[1]!) - at(b[0]!)).toBeGreaterThanOrEqual(250)
    // The second domain didn't wait for the first one's queue.
    expect(at(b[0]!)).toBeLessThan(at(a[1]!))
    expect(at(a[0]!)).toBeLessThan(at(b[1]!))
  })

  it('checks one listing now for a member of its hunt', async () => {
    const url = `https://${tag}-i.otodom.pl/pl/oferta/3-pokoje-ID4tAbC`
    routes.set(url, () => html(OTODOM_AD))
    const id = await addListing(url, { rent: 4500, admin_fee: 780 })

    const now = async (listingId: string, auth: string) => {
      const res = await handler(
        new Request('http://localhost/refresh-listings', {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId }),
        }),
      )
      return { status: res.status, body: await res.json() }
    }

    expect(await now(id, `Bearer ${token}`)).toMatchObject({
      status: 200,
      body: { outcome: 'price_changed', checked: 1, priceChanged: 1 },
    })
    expect((await getListing(id)).rent).toBe(4300)
    expect((await now(id, `Bearer ${strangerToken}`)).status).toBe(404)
    expect((await now(id, 'Bearer garbage')).status).toBe(401)
    expect((await now('nope', `Bearer ${token}`)).status).toBe(400)
  })
})
