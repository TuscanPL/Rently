import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createSearchHandler, type SearchRefreshResponse } from './index.ts'

// Integration test against the local stack (`supabase start`); skipped when it
// isn't running. Otodom is faked with the parser fixture: it isn't reachable here.
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const stackUp = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: ANON_KEY } })
  .then((r) => r.ok)
  .catch(() => false)

const SEARCH_URL =
  'https://www.otodom.pl/pl/wyniki/wynajem/mieszkanie/mazowieckie/warszawa/warszawa/warszawa?roomsNumber=%5BTHREE%5D'
const fixture = readFileSync(
  new URL('../../parsers/__fixtures__/otodom-search.html', import.meta.url),
  'utf8',
)
const nextData = JSON.parse(fixture.match(/<script id="__NEXT_DATA__"[^>]*>(.*)<\/script>/s)![1]!)

/** A results page: the fixture's ads on page 1, one made-up ad on each later page. */
function resultsPage(page: number, extra: { id: number; slug: string }[] = []) {
  const data = structuredClone(nextData)
  const ads = data.props.pageProps.data.searchAds
  if (page > 1) {
    ads.items = [
      { id: 66600000 + page, slug: `page-${page}-ad-ID${page}`, title: `Page ${page} ad` },
    ]
  }
  ads.items.push(...extra.map((e) => ({ ...e, title: 'New flat' })))
  ads.pagination.page = page
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`
}

describe.skipIf(!stackUp)('search-refresh', () => {
  const requests: string[] = []
  let mode: 'ok' | 'forbidden' | 'wall' = 'ok'
  let extraAds: { id: number; slug: string }[] = []
  let clock = new Date('2026-10-21T10:00:00Z')
  const handler = createSearchHandler({
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    serviceRoleKey: SERVICE_KEY,
    sleep: async () => {},
    maxWaitMs: 600_000,
    now: () => clock,
    fetchExternal: (async (input: RequestInfo | URL) => {
      const url = new URL(input.toString())
      requests.push(url.toString())
      if (mode === 'forbidden') return new Response('Access denied', { status: 403 })
      if (mode === 'wall') return new Response('<html>Please verify you are human</html>')
      const page = Number(url.searchParams.get('page') ?? 1)
      return new Response(resultsPage(page, page === 1 ? extraAds : []), {
        headers: { 'content-type': 'text/html' },
      })
    }) as typeof fetch,
  })
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  let token = ''
  let strangerToken = ''
  let searchId = ''
  let user = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })

  const call = async (body: unknown, auth = `Bearer ${token}`) => {
    const res = await handler(
      new Request('http://localhost/search-refresh', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
    return {
      status: res.status,
      body: (await res.json()) as SearchRefreshResponse & { error?: string },
    }
  }

  async function signUp(name: string) {
    const email = `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`
    await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
    const { data } = await anon.auth.signInWithPassword({ email, password: 'password123' })
    return data.session!.access_token
  }

  beforeAll(async () => {
    token = await signUp('browser')
    strangerToken = await signUp('stranger')
    user = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: hunt } = await user.rpc('create_hunt', { p_name: 'Browse test' })
    const { data: search, error } = await user
      .from('saved_searches')
      .insert({ hunt_id: (hunt as { id: string }).id, label: '3 rooms', url: SEARCH_URL })
      .select()
      .single()
    if (error) throw error
    searchId = search.id
  })

  const results = async () =>
    (
      await user
        .from('search_results')
        .select('external_id, title, rent, first_seen_at, last_seen_at, hidden_at')
        .eq('search_id', searchId)
        .order('external_id')
    ).data ?? []

  it('a refresh reads page 1 and stores the cards', async () => {
    const { status, body } = await call({ searchId })
    expect(status).toBe(200)
    expect(body).toEqual({
      refreshed: true,
      total: 3,
      newCount: 3,
      page: 1,
      loadedPages: 1,
      totalPages: 3,
      totalResults: 95,
    })
    expect(requests.map((u) => new URL(u).searchParams.get('page'))).toEqual([null])
    const rows = await results()
    expect(rows.map((r) => r.external_id)).toEqual(['66500001', '66500002', '66500003'])
    expect(rows[0]).toMatchObject({ title: '3 pokoje, balkon, blisko SKM Służewiec', rent: 4300 })
    const { data: search } = await user
      .from('saved_searches')
      .select('*')
      .eq('id', searchId)
      .single()
    expect(search).toMatchObject({
      last_total: 95,
      last_error: null,
      loaded_pages: 1,
      total_pages: 3,
    })
    expect(search!.first_refreshed_at).toBe(search!.last_refreshed_at)
  })

  it('loads further pages one at a time, in order, up to the last', async () => {
    requests.length = 0
    expect((await call({ searchId, page: 3 })).status).toBe(409)
    const two = await call({ searchId, page: 2 })
    expect(two.body).toMatchObject({
      refreshed: true,
      total: 1,
      newCount: 0,
      page: 2,
      loadedPages: 2,
    })
    expect((await call({ searchId, page: 3 })).body).toMatchObject({ page: 3, loadedPages: 3 })
    expect((await call({ searchId, page: 4 })).status).toBe(409)
    expect(requests.map((u) => new URL(u).searchParams.get('page'))).toEqual(['2', '3'])
    // Older ads reached by scrolling aren't "new".
    const rows = await results()
    const { data: search } = await user
      .from('saved_searches')
      .select('*')
      .eq('id', searchId)
      .single()
    const deep = rows.find((r) => r.external_id === '66600003')!
    expect(new Date(deep.first_seen_at).getTime()).toBe(
      new Date(search!.first_refreshed_at!).getTime(),
    )
    expect(rows).toHaveLength(5)
  })

  it('does not refresh again within a minute', async () => {
    requests.length = 0
    clock = new Date('2026-10-21T10:00:30Z')
    expect((await call({ searchId })).body).toMatchObject({
      refreshed: false,
      total: 5,
      loadedPages: 3,
    })
    expect(requests).toHaveLength(0)
  })

  it('a later refresh marks newly listed ads and starts again from page 1', async () => {
    clock = new Date('2026-10-21T12:00:00Z')
    extraAds = [{ id: 66509999, slug: 'brand-new-ID9' }]
    const { body } = await call({ searchId })
    expect(body).toMatchObject({ refreshed: true, total: 4, newCount: 1, loadedPages: 1 })
    const rows = await results()
    const fresh = rows.find((r) => r.external_id === '66509999')!
    const old = rows.find((r) => r.external_id === '66500001')!
    expect(new Date(fresh.first_seen_at).toISOString()).toBe('2026-10-21T12:00:00.000Z')
    expect(new Date(old.first_seen_at).getTime()).toBeLessThan(Date.parse('2026-10-21T11:00:00Z'))
    expect(new Date(old.last_seen_at).toISOString()).toBe('2026-10-21T12:00:00.000Z')
    // Page 2 can be loaded again after the refresh.
    expect((await call({ searchId, page: 2 })).body).toMatchObject({ page: 2 })
  })

  it('lets members hide a card for the hunt but not edit or add cards', async () => {
    const { error: hideError } = await user
      .from('search_results')
      .update({ hidden_at: new Date().toISOString() })
      .eq('search_id', searchId)
      .eq('external_id', '66500002')
    expect(hideError).toBeNull()
    await user
      .from('search_results')
      .update({ title: 'hacked' } as never)
      .eq('search_id', searchId)
      .eq('external_id', '66500001')
    const { error: insertError } = await user.from('search_results').insert({
      search_id: searchId,
      external_id: 'x',
      hunt_id: crypto.randomUUID(),
      url: 'https://x',
    })
    expect(insertError).not.toBeNull()
    const rows = await results()
    expect(rows.find((r) => r.external_id === '66500001')!.title).not.toBe('hacked')
    expect(rows.find((r) => r.external_id === '66500002')!.hidden_at).not.toBeNull()

    // A refresh keeps it hidden.
    clock = new Date('2026-10-21T13:00:00Z')
    await call({ searchId })
    expect((await results()).find((r) => r.external_id === '66500002')!.hidden_at).not.toBeNull()
  })

  it('records a blocked or unreadable Otodom answer instead of wiping results', async () => {
    clock = new Date('2026-10-21T14:00:00Z')
    mode = 'forbidden'
    expect(await call({ searchId })).toMatchObject({
      status: 502,
      body: { error: 'Otodom answered 403' },
    })
    clock = new Date('2026-10-21T15:00:00Z')
    mode = 'wall'
    expect((await call({ searchId })).body.error).toBe("Otodom didn't send search results")
    const { data: search } = await user
      .from('saved_searches')
      .select('last_error')
      .eq('id', searchId)
      .single()
    expect(search!.last_error).toBe("Otodom didn't send search results")
    expect(await results()).toHaveLength(6)
    mode = 'ok'
  })

  it('forgets the old results when the search URL changes', async () => {
    await user
      .from('saved_searches')
      .update({ url: `${SEARCH_URL}&priceMax=5000` })
      .eq('id', searchId)
    expect(await results()).toHaveLength(0)
    const { data: search } = await user
      .from('saved_searches')
      .select('*')
      .eq('id', searchId)
      .single()
    expect(search).toMatchObject({ last_refreshed_at: null, first_refreshed_at: null })
    // Bookkeeping columns are the function's, not the members'.
    const { error } = await user
      .from('saved_searches')
      .update({ last_error: 'x' } as never)
      .eq('id', searchId)
    expect(error).not.toBeNull()
  })

  it('only serves members and refuses other sites', async () => {
    expect((await call({ searchId }, `Bearer ${strangerToken}`)).status).toBe(404)
    expect((await call({ searchId }, 'Bearer nope')).status).toBe(401)
    expect((await call({ searchId: 'x' })).status).toBe(400)
    const { data: hunt } = await user.from('hunts').select('id').limit(1).single()
    const { error } = await user
      .from('saved_searches')
      .insert({ hunt_id: hunt!.id, label: 'olx', url: 'https://www.olx.pl/nieruchomosci/' })
    expect(error).not.toBeNull()
  })
})
