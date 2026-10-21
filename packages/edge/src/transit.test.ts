import { beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createTransitHandler, nextArrival, pickTrip, type TransitResponse } from './index.ts'
import { encodePolyline } from '@at/shared'
import { legPath, planSchema } from './transit.ts'

// Integration tests run against the local stack (`supabase start`) and are skipped
// when it isn't running. Transitous is faked: it isn't reachable from CI.
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

// A MOTIS `plan` answer: walk → tram 17 → metro M1 → walk, plus a long direct walk.
const tramMetroPlan = {
  itineraries: [
    {
      duration: 2460,
      startTime: '2026-10-27T07:19:00Z',
      endTime: '2026-10-27T08:00:00Z',
      transfers: 1,
      legs: [
        { mode: 'WALK', duration: 300, from: { name: 'START' }, to: { name: 'Bokserska' } },
        {
          mode: 'TRAM',
          duration: 900,
          routeShortName: '17',
          from: { name: 'Bokserska' },
          to: { name: 'Wilanowska' },
        },
        {
          mode: 'SUBWAY',
          duration: 1020,
          routeShortName: 'M1',
          from: { name: 'Wilanowska' },
          to: { name: 'Centrum' },
        },
        { mode: 'WALK', duration: 240, from: { name: 'Centrum' }, to: { name: 'END' } },
      ],
    },
    {
      duration: 3000,
      startTime: '2026-10-27T07:10:00Z',
      endTime: '2026-10-27T07:58:00Z',
      transfers: 2,
      legs: [{ mode: 'BUS', duration: 3000, routeShortName: '139' }],
    },
  ],
  direct: [{ duration: 6600, legs: [{ mode: 'WALK', duration: 6600 }] }],
}

describe('pickTrip', () => {
  it('takes the quickest itinerary and sums the walking', () => {
    const trip = pickTrip(planSchema.parse(tramMetroPlan))
    expect(trip).toEqual({
      status: 'ok',
      durationMin: 41,
      transfers: 1,
      walkMin: 9,
      departsAt: '2026-10-27T07:19:00Z',
      arrivesAt: '2026-10-27T08:00:00Z',
      legs: [
        expect.objectContaining({
          mode: 'WALK',
          line: null,
          from: 'START',
          to: 'Bokserska',
          minutes: 5,
        }),
        expect.objectContaining({
          mode: 'TRAM',
          line: '17',
          from: 'Bokserska',
          to: 'Wilanowska',
          minutes: 15,
        }),
        expect.objectContaining({
          mode: 'SUBWAY',
          line: 'M1',
          from: 'Wilanowska',
          to: 'Centrum',
          minutes: 17,
        }),
        expect.objectContaining({
          mode: 'WALK',
          line: null,
          from: 'Centrum',
          to: 'END',
          minutes: 4,
        }),
      ],
    })
  })

  it('prefers walking when it is quicker than any transit', () => {
    const trip = pickTrip(
      planSchema.parse({
        itineraries: [{ duration: 900, legs: [{ mode: 'BUS', duration: 900 }] }],
        direct: [{ duration: 600, legs: [{ mode: 'WALK', duration: 600 }] }],
      }),
    )
    expect(trip).toMatchObject({ status: 'ok', durationMin: 10, transfers: 0, walkMin: 10 })
  })

  it('counts transfers from the legs when the planner leaves them out', () => {
    const trip = pickTrip(
      planSchema.parse({
        itineraries: [
          {
            duration: 1800,
            legs: [
              { mode: 'BUS', startTime: '2026-10-27T07:00:00Z', endTime: '2026-10-27T07:10:00Z' },
              { mode: 'TRAM', duration: 1200 },
            ],
          },
        ],
      }),
    )
    expect(trip).toMatchObject({ transfers: 1, walkMin: 0 })
    expect(trip.status === 'ok' && trip.legs[0]!.minutes).toBe(10)
  })

  it('reports no route when the planner found nothing', () => {
    expect(pickTrip(planSchema.parse({ itineraries: [], direct: [] }))).toEqual({
      status: 'no_route',
    })
  })
})

describe('legPath', () => {
  const tram: [number, number][] = [
    [52.1806, 21.0006],
    [52.1855, 21.0042],
    [52.1897, 21.0081],
  ]
  const leg = (points: string, precision?: number, from = { lat: 52.1806, lon: 21.0006 }) => ({
    mode: 'TRAM',
    from,
    legGeometry: { points, ...(precision ? { precision } : {}) },
  })

  it('keeps the shape with its stated precision', () => {
    expect(legPath(leg(encodePolyline(tram, 6), 6) as never)).toEqual({
      points: encodePolyline(tram, 6),
      precision: 6,
    })
  })

  it('works out an unstated precision from where the leg starts', () => {
    for (const p of [5, 7]) {
      expect(legPath(leg(encodePolyline(tram, p)) as never)?.precision).toBe(p)
    }
  })

  it('drops a shape that does not start near the leg', () => {
    const elsewhere = encodePolyline(
      [
        [50.06, 19.94],
        [50.07, 19.95],
      ],
      6,
    )
    expect(legPath(leg(elsewhere, 6) as never)).toBeNull()
  })

  it('is null without geometry', () => {
    expect(legPath({ mode: 'WALK' } as never)).toBeNull()
  })

  it('stores stop coordinates and the shape on each leg', () => {
    const trip = pickTrip(
      planSchema.parse({
        itineraries: [
          {
            duration: 600,
            legs: [
              {
                mode: 'TRAM',
                duration: 600,
                routeShortName: '17',
                from: { name: 'A', lat: 52.1806, lon: 21.0006 },
                to: { name: 'B', lat: 52.1897, lon: 21.0081 },
                legGeometry: { points: encodePolyline(tram, 7), precision: 7 },
              },
            ],
          },
        ],
      }),
    )
    expect(trip.status === 'ok' && trip.legs[0]).toMatchObject({
      fromLat: 52.1806,
      fromLng: 21.0006,
      toLat: 52.1897,
      toLng: 21.0081,
      path: { points: encodePolyline(tram, 7), precision: 7 },
    })
  })
})

describe('nextArrival', () => {
  it('finds the next Tuesday 9:00 Warsaw time in winter (UTC+1)', () => {
    // Wednesday 2026-11-04, noon UTC.
    expect(nextArrival(2, '09:00:00', new Date('2026-11-04T12:00:00Z')).toISOString()).toBe(
      '2026-11-10T08:00:00.000Z',
    )
  })

  it('handles summer time (UTC+2)', () => {
    // Monday 2026-06-01 → Saturday 2026-06-06 12:30.
    expect(nextArrival(6, '12:30', new Date('2026-06-01T10:00:00Z')).toISOString()).toBe(
      '2026-06-06T10:30:00.000Z',
    )
  })

  it('never picks today, so the timetable for the day is published', () => {
    // Tuesday 2026-11-03 at 06:00 Warsaw: the next Tuesday is a week later.
    expect(nextArrival(2, '09:00', new Date('2026-11-03T05:00:00Z')).toISOString()).toBe(
      '2026-11-10T08:00:00.000Z',
    )
  })

  it('uses the Warsaw date, not the UTC one, around midnight', () => {
    // 23:30 UTC on Monday is already Tuesday 00:30 in Warsaw → next Wednesday is tomorrow.
    expect(nextArrival(3, '08:00', new Date('2026-11-02T23:30:00Z')).toISOString()).toBe(
      '2026-11-04T07:00:00.000Z',
    )
  })

  it('crosses the end of summer time correctly', () => {
    // Saturday 2026-10-24 (UTC+2) → Monday 2026-10-26 is already UTC+1.
    expect(nextArrival(1, '09:00', new Date('2026-10-24T10:00:00Z')).toISOString()).toBe(
      '2026-10-26T08:00:00.000Z',
    )
  })
})

describe.skipIf(!stackUp)('transit-routes', () => {
  const requests: URL[] = []
  let mode: 'ok' | 'empty' | 'fail' = 'ok'
  const fakeTransitous = async (input: RequestInfo | URL) => {
    const url = new URL(input.toString())
    requests.push(url)
    if (mode === 'fail') return new Response('upstream down', { status: 502 })
    if (mode === 'empty') return Response.json({ itineraries: [], direct: [] })
    return Response.json(tramMetroPlan)
  }
  const handler = createTransitHandler({
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    serviceRoleKey: SERVICE_KEY,
    fetchExternal: fakeTransitous as typeof fetch,
    sleep: async () => {},
    maxWaitMs: 600_000,
  })
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  let token = ''
  let strangerToken = ''
  let huntId = ''
  let user = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })

  const call = async (body: unknown, auth = `Bearer ${token}`) => {
    const res = await handler(
      new Request('http://localhost/transit-routes', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
    return { status: res.status, body: (await res.json()) as TransitResponse }
  }

  async function signUp(name: string) {
    const email = `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`
    await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
    const { data } = await anon.auth.signInWithPassword({ email, password: 'password123' })
    return data.session!.access_token
  }

  beforeAll(async () => {
    token = await signUp('transit')
    strangerToken = await signUp('stranger')
    user = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: hunt } = await user.rpc('create_hunt', { p_name: 'Transit test' })
    huntId = (hunt as { id: string }).id
  })

  const routes = async () =>
    (
      await user
        .from('listing_routes')
        .select('listing_id, pin_id, status, duration_min, transfers, walk_min, legs')
        .order('pin_id')
    ).data ?? []

  it('looks up every listing → pin trip once and stores it', async () => {
    const { data: work } = await user
      .from('pins')
      .insert({ hunt_id: huntId, label: 'Office', lat: 52.2297, lng: 21.0122, kind: 'work' })
      .select()
      .single()
    await user.from('pins').insert({
      hunt_id: huntId,
      label: 'Mum',
      lat: 52.25,
      lng: 20.95,
      kind: 'family',
      arrive_weekday: 6,
      arrive_time: '12:00',
    })
    const { data: listing } = await user
      .from('listings')
      .insert({ hunt_id: huntId, title: 'Flat', lat: 52.1808, lng: 20.9997 })
      .select()
      .single()
    // A listing without coordinates is skipped.
    await user.from('listings').insert({ hunt_id: huntId, title: 'Somewhere' })

    expect(await call({ huntId })).toEqual({ status: 200, body: { computed: 2, remaining: 0 } })
    const rows = await routes()
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.listing_id === listing!.id && r.status === 'ok')).toBe(true)
    expect(rows[0]).toMatchObject({ duration_min: 41, transfers: 1, walk_min: 9 })
    expect((rows[0]!.legs as { line: string }[]).map((l) => l.line)).toEqual([
      null,
      '17',
      'M1',
      null,
    ])

    // The request: from the listing to the pin, arriving by the pin's time.
    const officeReq = requests.find((u) => u.searchParams.get('toPlace') === '52.2297,21.0122')!
    expect(officeReq.host).toBe('api.transitous.org')
    expect(officeReq.searchParams.get('fromPlace')).toBe('52.1808,20.9997')
    expect(officeReq.searchParams.get('arriveBy')).toBe('true')
    const arrive = new Date(officeReq.searchParams.get('time')!)
    expect(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Warsaw',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(arrive),
    ).toBe('Tue 09:00')

    // Already stored: nothing to do.
    requests.length = 0
    expect((await call({ huntId })).body).toEqual({ computed: 0, remaining: 0 })
    expect(requests).toHaveLength(0)

    // Moving the pin drops its trips; the next call looks them up again.
    await user.from('pins').update({ lat: 52.23 }).eq('id', work!.id)
    expect(await routes()).toHaveLength(1)
    expect((await call({ huntId, pinId: work!.id })).body).toEqual({ computed: 1, remaining: 0 })
    expect(await routes()).toHaveLength(2)
  })

  it('stores "no route" and failures, and keeps failures for a later retry', async () => {
    const { data: listing } = await user
      .from('listings')
      .insert({ hunt_id: huntId, title: 'Far away', lat: 50.06, lng: 19.94 })
      .select()
      .single()
    mode = 'empty'
    const pins = (await user.from('pins').select('id').eq('hunt_id', huntId)).data!
    expect((await call({ huntId, listingId: listing!.id, pinId: pins[0]!.id })).body).toEqual({
      computed: 1,
      remaining: 0,
    })
    mode = 'fail'
    expect((await call({ huntId, listingId: listing!.id })).body).toEqual({
      computed: 1,
      remaining: 0,
    })
    const statuses = (await routes())
      .filter((r) => r.listing_id === listing!.id)
      .map((r) => r.status)
      .sort()
    expect(statuses).toEqual(['error', 'no_route'])
    // A fresh failure isn't retried straight away.
    mode = 'ok'
    expect((await call({ huntId, listingId: listing!.id })).body).toEqual({
      computed: 0,
      remaining: 0,
    })
  })

  it('stops after its per-call cap and reports what is left', async () => {
    const capped = createTransitHandler({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      serviceRoleKey: SERVICE_KEY,
      fetchExternal: fakeTransitous as typeof fetch,
      sleep: async () => {},
      maxWaitMs: 600_000,
      maxPairs: 1,
    })
    await user.from('listings').insert([
      { hunt_id: huntId, title: 'A', lat: 52.2, lng: 21.0 },
      { hunt_id: huntId, title: 'B', lat: 52.21, lng: 21.01 },
    ])
    const res = await capped(
      new Request('http://localhost/transit-routes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ huntId }),
      }),
    )
    expect(await res.json()).toEqual({ computed: 1, remaining: 3 })
  })

  it('only serves members, and clients cannot write routes', async () => {
    expect((await call({ huntId }, `Bearer ${strangerToken}`)).status).toBe(404)
    expect((await call({ huntId }, 'Bearer garbage')).status).toBe(401)
    expect((await call({ huntId: 'nope' })).status).toBe(400)
    const { data: listing } = await user.from('listings').select('id').eq('title', 'Flat').single()
    const pin = (await user.from('pins').select('id').eq('hunt_id', huntId)).data![0]!
    const { error } = await user
      .from('listing_routes')
      .upsert({ listing_id: listing!.id, pin_id: pin.id, status: 'ok', duration_min: 1 })
    expect(error).not.toBeNull()
  })
})
