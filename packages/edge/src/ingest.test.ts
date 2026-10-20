import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createIngestHandler, type IngestResponse } from './index.ts'

// Integration test against the local stack (`supabase start`); skipped when it isn't running.
// The defaults are the well-known keys every local Supabase stack uses.
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

const fixture = (name: string) =>
  readFileSync(new URL(`../../parsers/__fixtures__/${name}`, import.meta.url), 'utf8')

const OTODOM_URL = 'https://www.otodom.pl/pl/oferta/3-pokoje-64-m-mokotow-blisko-skm-ID4tAbC'
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)

const external: string[] = []
async function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = input.toString()
  external.push(url)
  if (url.startsWith('https://www.otodom.pl/')) {
    return new Response(fixture('otodom-ad.html'), { headers: { 'content-type': 'text/html' } })
  }
  if (url.includes('olxcdn.com'))
    return new Response(PNG, { headers: { 'content-type': 'image/png' } })
  return new Response('Forbidden', { status: 403 })
}

describe.skipIf(!stackUp)('ingest-listing', () => {
  const handler = createIngestHandler({
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    fetchExternal: fakeFetch as typeof fetch,
    sleep: async () => {},
    maxWaitMs: 60_000,
  })
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  let token = ''
  let huntId = ''
  let user = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })

  const call = async (body: unknown, auth = `Bearer ${token}`) => {
    const res = await handler(
      new Request('http://localhost/ingest-listing', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
    return { status: res.status, body: (await res.json()) as IngestResponse & { error?: string } }
  }

  beforeAll(async () => {
    const email = `ingest-${Date.now()}@test.local`
    const { error } = await admin.auth.admin.createUser({
      email,
      password: 'password123',
      email_confirm: true,
    })
    if (error) throw error
    const { data, error: signInError } = await user.auth.signInWithPassword({
      email,
      password: 'password123',
    })
    if (signInError) throw signInError
    token = data.session!.access_token
    user = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: hunt, error: huntError } = await user.rpc('create_hunt', {
      p_name: 'Ingest test',
    })
    if (huntError) throw huntError
    huntId = (hunt as { id: string }).id
  })

  it('fetches, parses and saves an Otodom ad with photos and a cached cover', async () => {
    const { status, body } = await call({ huntId, url: `${OTODOM_URL}?utm_source=share` })
    expect(status).toBe(200)
    expect(body).toMatchObject({
      existing: false,
      needsDetails: false,
      fetched: true,
      confidence: 1,
    })

    const { data: listing } = await user
      .from('listings')
      .select('*')
      .eq('id', body.listingId)
      .single()
    expect(listing).toMatchObject({
      source: 'otodom',
      canonical_url: 'https://otodom.pl/oferta/3-pokoje-64-m-mokotow-blisko-skm-ID4tAbC',
      rent: 4300,
      admin_fee: 780,
      utilities_estimate: 350,
      area_m2: 64.2,
      rooms: 3,
      district: 'Mokotów',
      advertiser_type: 'private',
      needs_details: false,
    })
    expect(listing!.raw).toHaveProperty('target')

    const { data: photos } = await user
      .from('listing_photos')
      .select('*')
      .eq('listing_id', body.listingId)
      .order('position')
    expect(photos).toHaveLength(2)
    expect(photos![0]).toMatchObject({
      is_cover: true,
      storage_path: `${huntId}/${body.listingId}/cover.png`,
    })
    expect(photos![1]!.storage_path).toBeNull()
    expect(external).toContain(
      'https://ireland.apollo.olxcdn.com/v1/files/aaa-PL/image;s=314x236;q=80',
    )

    const { data: events } = await user
      .from('listing_events')
      .select('type')
      .eq('listing_id', body.listingId)
    expect(events).toEqual([{ type: 'added' }])
    const { data: history } = await user
      .from('listing_price_history')
      .select('rent')
      .eq('listing_id', body.listingId)
    expect(history).toEqual([{ rent: 4300 }])
  })

  it('returns the existing listing for the same ad under another URL form', async () => {
    const { body } = await call({
      huntId,
      url: 'http://otodom.pl/oferta/3-pokoje-64-m-mokotow-blisko-skm-ID4tAbC#x',
    })
    expect(body.existing).toBe(true)
  })

  it('saves a partial listing when the site blocks fetching', async () => {
    const { status, body } = await call({
      huntId,
      url: 'https://www.morizon.pl/oferta/wynajem-mieszkanie-warszawa-wola-48m2-mzn2041',
    })
    expect(status).toBe(200)
    expect(body).toMatchObject({ existing: false, needsDetails: true, fetched: false })
    const { data } = await user
      .from('listings')
      .select('title, source, needs_details')
      .eq('id', body.listingId)
      .single()
    expect(data).toEqual({
      title: 'Wynajem mieszkanie warszawa wola 48m2 mzn2041',
      source: 'morizon',
      needs_details: true,
    })
  })

  it('creates a listing from pasted text and flags a likely duplicate', async () => {
    const { data: original } = await user
      .from('listings')
      .select('id')
      .eq('source', 'otodom')
      .single()
    const { body } = await call({
      huntId,
      text: 'Wynajmę 3 pokoje, 64 m2, Mokotów. 4300 zł + czynsz administracyjny 780 zł',
      fields: { district: 'Mokotów' },
    })
    expect(body).toMatchObject({ existing: false, needsDetails: false })
    expect(body.possibleDuplicates.map((d) => d.id)).toEqual([original!.id])
    const { data } = await user
      .from('listings')
      .select('source, rent, admin_fee, rooms')
      .eq('id', body.listingId)
      .single()
    expect(data).toEqual({ source: 'facebook', rent: 4300, admin_fee: 780, rooms: 3 })
  })

  it('attaches uploaded photos only from the same hunt folder', async () => {
    const { body } = await call({
      huntId,
      text: 'Kawalerka',
      photoPaths: [`${huntId}/uploads/a.webp`, 'some-other-hunt/uploads/b.webp'],
    })
    const { data: photos } = await user
      .from('listing_photos')
      .select('storage_path, is_cover')
      .eq('listing_id', body.listingId)
    expect(photos).toEqual([{ storage_path: `${huntId}/uploads/a.webp`, is_cover: true }])
    expect(body.needsDetails).toBe(true)
  })

  it('finds the kept listing when a merged-away ad is added again', async () => {
    const dropUrl = 'https://warszawa.nieruchomosci-online.pl/mieszkanie,na-wynajem/25999999.html'
    const keep = await call({ huntId, text: 'Kawalerka na Woli, 2500 zł', fields: { rooms: 1 } })
    const drop = await call({ huntId, url: dropUrl })
    expect(drop.body.existing).toBe(false)
    const { error } = await user.rpc('merge_listings', {
      p_keep: keep.body.listingId,
      p_drop: drop.body.listingId,
    })
    expect(error).toBeNull()

    // The kept listing had no URL, so it took the dropped one's; merge another into it.
    const other = await call({
      huntId,
      url: 'https://warszawa.nieruchomosci-online.pl/mieszkanie,na-wynajem/25888888.html',
    })
    await user.rpc('merge_listings', { p_keep: keep.body.listingId, p_drop: other.body.listingId })

    const again = await call({
      huntId,
      url: 'https://warszawa.nieruchomosci-online.pl/mieszkanie,na-wynajem/25888888.html?utm_source=x',
    })
    expect(again.body).toMatchObject({ existing: true, listingId: keep.body.listingId })
    expect((await call({ huntId, url: dropUrl })).body).toMatchObject({
      existing: true,
      listingId: keep.body.listingId,
    })
  })

  it('rejects other hunts, bad bodies and missing auth', async () => {
    expect((await call({ huntId: crypto.randomUUID(), url: OTODOM_URL })).status).toBe(404)
    expect((await call({ huntId: 'nope' })).status).toBe(400)
    expect((await call({ huntId, url: OTODOM_URL }, 'Bearer garbage')).status).toBe(401)
  })
})
