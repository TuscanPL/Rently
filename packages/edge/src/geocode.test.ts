import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import {
  createGeocodeHandler,
  createGeocoder,
  createIngestHandler,
  type GeocodeResponse,
  type IngestResponse,
} from './index.ts'
import { normalizeQuery } from './geocode.ts'

// Integration test against the local stack (`supabase start`); skipped when it isn't running.
// Nominatim is mocked: OpenStreetMap isn't reachable from CI.
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

describe('normalizeQuery', () => {
  it('ignores case, spacing and trailing punctuation', () => {
    expect(normalizeQuery('  Puławska 145 ,Mokotów,  WARSZAWA. ')).toBe(
      'puławska 145, mokotów, warszawa',
    )
  })
})

// Unique per run so cached answers from an earlier run don't leak in.
const run = Date.now().toString(36)
const requests: { url: URL; headers: Headers }[] = []
async function fakeNominatim(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input.toString())
  requests.push({ url, headers: new Headers(init?.headers) })
  const locationIq = url.hostname === 'eu1.locationiq.com'
  if (!locationIq && url.hostname !== 'nominatim.openstreetmap.org') {
    return new Response('nope', { status: 403 })
  }
  if (locationIq && url.searchParams.get('key') !== 'liq-test') {
    return Response.json({ error: 'Invalid key' }, { status: 401 })
  }
  if (locationIq && url.searchParams.get('format') !== 'json') {
    return new Response('<error>Invalid Request</error>', { status: 400 })
  }
  const q = url.searchParams.get('q') ?? ''
  if (q.includes('boom')) return new Response('oops', { status: 500 })
  if (q.includes('nowhere')) {
    return locationIq
      ? Response.json({ error: 'Unable to geocode' }, { status: 404 })
      : Response.json([])
  }
  return Response.json([
    { lat: '52.1812', lon: '21.0021', display_name: `Somewhere for ${q}`, place_id: 1 },
  ])
}

describe.skipIf(!stackUp)('geocode', () => {
  const sleeps: number[] = []
  const options = {
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SERVICE_KEY,
    fetchExternal: fakeNominatim as typeof fetch,
    sleep: async (ms: number) => void sleeps.push(ms),
    maxWaitMs: 600_000,
  }
  const handler = createGeocodeHandler({
    ...options,
    anonKey: ANON_KEY,
    nominatimEmail: 'maintainer@test.local',
  })
  let token = ''
  let user = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })

  const call = async (body: unknown, auth = `Bearer ${token}`) => {
    const res = await handler(
      new Request('http://localhost/geocode', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
    return { status: res.status, body: (await res.json()) as GeocodeResponse & { error?: string } }
  }

  beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    const email = `geocode-${Date.now()}@test.local`
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
  })

  beforeEach(() => {
    requests.length = 0
  })

  it('asks Nominatim once, then answers from the cache', async () => {
    const first = await call({ q: `Puławska ${run}`, city: 'Warszawa' })
    expect(first).toEqual({
      status: 200,
      body: {
        found: true,
        cached: false,
        lat: 52.1812,
        lng: 21.0021,
        displayName: `Somewhere for puławska ${run}, warszawa`,
      },
    })
    expect(requests).toHaveLength(1)
    const { url, headers } = requests[0]!
    expect(url.pathname).toBe('/search')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: `puławska ${run}, warszawa`,
      format: 'jsonv2',
      limit: '1',
      countrycodes: 'pl',
      email: 'maintainer@test.local',
    })
    expect(headers.get('User-Agent')).toMatch(/^ApartmentTogether\//)

    // Same place, different spelling of the query: cached.
    requests.length = 0
    const second = await call({ q: `  PUŁAWSKA ${run} , warszawa ` })
    expect(second.body).toMatchObject({ found: true, cached: true, lat: 52.1812 })
    expect(requests).toHaveLength(0)
  })

  it('caches misses too', async () => {
    const first = await call({ q: `nowhere ${run}` })
    expect(first).toEqual({ status: 200, body: { found: false, cached: false } })
    const second = await call({ q: `Nowhere ${run}` })
    expect(second.body).toEqual({ found: false, cached: true })
    expect(requests).toHaveLength(1)
  })

  it('does not cache Nominatim errors', async () => {
    expect((await call({ q: `boom ${run}` })).status).toBe(503)
    expect((await call({ q: `boom ${run}` })).status).toBe(503)
    expect(requests).toHaveLength(2)
  })

  it('spaces Nominatim requests through the shared throttle', async () => {
    sleeps.length = 0
    await call({ q: `a ${run}` })
    await call({ q: `b ${run}` })
    // Mocked sleeps don't wait, so the second request is told to wait a full slot.
    expect(sleeps.at(-1)).toBeGreaterThanOrEqual(1000)
  })

  it('gives up instead of queueing behind a long wait', async () => {
    const impatient = createGeocoder({ ...options, maxWaitMs: 0 })
    await impatient(`c ${run}`)
    expect(await impatient(`d ${run}`)).toEqual({ status: 'unavailable' })
  })

  it('uses LocationIQ when a key is set, reading its 404 as no match', async () => {
    const liq = createGeocoder({ ...options, locationIqKey: 'liq-test' })
    expect(await liq(`liq ${run}`)).toMatchObject({ status: 'found', cached: false })
    expect(requests.at(-1)!.url.hostname).toBe('eu1.locationiq.com')
    expect(requests.at(-1)!.url.searchParams.get('key')).toBe('liq-test')
    expect(await liq(`nowhere liq ${run}`)).toEqual({ status: 'not_found', cached: false })
    expect(await liq(`nowhere liq ${run}`)).toEqual({ status: 'not_found', cached: true })
    const badKey = createGeocoder({ ...options, locationIqKey: 'wrong' })
    expect(await badKey(`liq bad ${run}`)).toEqual({ status: 'unavailable' })
  })

  it('rejects bad bodies and missing auth', async () => {
    expect((await call({ q: 'x' })).status).toBe(400)
    expect((await call({})).status).toBe(400)
    expect((await call({ q: 'Puławska' }, 'Bearer garbage')).status).toBe(401)
  })

  it('keeps the cache away from clients', async () => {
    const { data, error } = await user.from('geocode_cache').select('*')
    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
    const { error: writeError } = await user
      .from('geocode_cache')
      .insert({ query: `planted ${run}`, lat: 1, lng: 1 })
    expect(writeError?.code).toBe('42501')
  })

  it('places listings added without coordinates during ingest', async () => {
    const ingest = createIngestHandler({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      fetchExternal: fakeNominatim as typeof fetch,
      geocode: createGeocoder(options),
    })
    const { data: hunt } = await user.rpc('create_hunt', { p_name: 'Geocode test' })
    const huntId = (hunt as { id: string }).id
    const add = async (fields: Record<string, unknown>) => {
      const res = await ingest(
        new Request('http://localhost/ingest-listing', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ huntId, text: '3 pokoje', fields }),
        }),
      )
      const { listingId } = (await res.json()) as IngestResponse
      const { data } = await user.from('listings').select('lat, lng').eq('id', listingId).single()
      return data
    }

    expect(await add({ address: `Woronicza ${run}`, district: 'Mokotów' })).toEqual({
      lat: 52.1812,
      lng: 21.0021,
    })
    expect(requests.at(-1)!.url.searchParams.get('q')).toBe(`woronicza ${run}, mokotów, warszawa`)

    // Not found, unreachable, or nothing to go on: saved without coordinates.
    expect(await add({ district: `nowhere ${run}` })).toEqual({ lat: null, lng: null })
    expect(await add({ address: `boom ${run}` })).toEqual({ lat: null, lng: null })
    requests.length = 0
    expect(await add({ rent: 3000 })).toEqual({ lat: null, lng: null })
    expect(requests).toHaveLength(0)
  })
})
