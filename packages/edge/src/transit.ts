import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@at/shared/database'
import { HttpError, json, withHttp } from './http.ts'

type Db = SupabaseClient<Database>
type RouteRow = Database['public']['Tables']['listing_routes']['Insert']

// Public transport trips from listings to pins, planned with Transitous
// (https://transitous.org): a free, community-run MOTIS instance with the open
// timetables for Warsaw (ZTM, SKM, KM, WKD). Each trip is looked up once and
// stored in listing_routes; this function only fills in the missing ones.

export const TRANSITOUS_HOST = 'api.transitous.org'
export const DEFAULT_TRANSITOUS_URL = `https://${TRANSITOUS_HOST}/api/v1/plan`
// Transitous asks for modest, identifiable traffic. One request a second is plenty.
const TRANSITOUS_INTERVAL_MS = 1000
const USER_AGENT = 'ApartmentTogether/1.0 (shared apartment-hunting app; commute times)'
/** A failed lookup is retried after this long; found/no-route results are kept. */
const ERROR_RETRY_MS = 6 * 3600_000

export interface TransitLeg {
  /** WALK, BUS, TRAM, SUBWAY, RAIL, … as Transitous names them. */
  mode: string
  line: string | null
  from: string | null
  to: string | null
  minutes: number
}

export type TripOutcome =
  | {
      status: 'ok'
      durationMin: number
      transfers: number
      walkMin: number
      legs: TransitLeg[]
      departsAt: string | null
      arrivesAt: string | null
    }
  | { status: 'no_route' }
  /** The planner failed or was unreachable; logged, retried later. */
  | { status: 'error' }

// MOTIS `plan` response, read leniently: only what we show, everything optional.
const placeSchema = z.object({ name: z.string().nullish() }).passthrough().nullish()
const legSchema = z
  .object({
    mode: z.string(),
    duration: z.number().nullish(),
    startTime: z.string().nullish(),
    endTime: z.string().nullish(),
    routeShortName: z.string().nullish(),
    from: placeSchema,
    to: placeSchema,
  })
  .passthrough()
const itinerarySchema = z
  .object({
    duration: z.number(),
    startTime: z.string().nullish(),
    endTime: z.string().nullish(),
    transfers: z.number().nullish(),
    legs: z.array(legSchema).default([]),
  })
  .passthrough()
export const planSchema = z
  .object({
    itineraries: z.array(itinerarySchema).default([]),
    direct: z.array(itinerarySchema).default([]),
  })
  .passthrough()

type Itinerary = z.infer<typeof itinerarySchema>

const minutes = (seconds: number) => Math.max(0, Math.round(seconds / 60))

function legSeconds(leg: z.infer<typeof legSchema>): number {
  if (leg.duration != null) return leg.duration
  if (leg.startTime && leg.endTime)
    return (Date.parse(leg.endTime) - Date.parse(leg.startTime)) / 1000
  return 0
}

/** The quickest trip: transit itineraries and the direct (walking) option compete. */
export function pickTrip(plan: z.infer<typeof planSchema>): TripOutcome {
  const all: Itinerary[] = [...plan.itineraries, ...plan.direct]
  if (all.length === 0) return { status: 'no_route' }
  const best = all.reduce((a, b) => (b.duration < a.duration ? b : a))
  const legs: TransitLeg[] = best.legs.map((leg) => ({
    mode: leg.mode,
    line: leg.routeShortName ?? null,
    from: leg.from?.name ?? null,
    to: leg.to?.name ?? null,
    minutes: minutes(legSeconds(leg)),
  }))
  const transitLegs = legs.filter((l) => l.mode !== 'WALK').length
  return {
    status: 'ok',
    durationMin: minutes(best.duration),
    transfers: best.transfers ?? Math.max(0, transitLegs - 1),
    walkMin: legs.filter((l) => l.mode === 'WALK').reduce((sum, l) => sum + l.minutes, 0),
    legs,
    departsAt: best.startTime ?? null,
    arrivesAt: best.endTime ?? null,
  }
}

const WARSAW = 'Europe/Warsaw'

/** Minutes Warsaw is ahead of UTC at a given instant (60 in winter, 120 in summer). */
function warsawOffsetMin(instant: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: WARSAW,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!)
  return Math.round((asUtc - instant.getTime()) / 60_000)
}

/**
 * The next `weekday` (ISO, 1 = Monday) at `time` ("HH:MM[:SS]") Warsaw time, at
 * least a day after `now` so the timetable for that day is published.
 */
export function nextArrival(weekday: number, time: string, now = new Date()): Date {
  const [hh = 0, mm = 0] = time.split(':').map(Number)
  const todayWarsaw = new Date(now.getTime() + warsawOffsetMin(now) * 60_000)
  const todayIso = ((todayWarsaw.getUTCDay() + 6) % 7) + 1
  let days = (weekday - todayIso + 7) % 7
  if (days < 1) days += 7
  const y = todayWarsaw.getUTCFullYear()
  const m = todayWarsaw.getUTCMonth()
  const d = todayWarsaw.getUTCDate() + days
  // Treat the wall-clock time as UTC, then shift by Warsaw's offset on that date.
  const guess = new Date(Date.UTC(y, m, d, hh, mm))
  const exact = new Date(guess.getTime() - warsawOffsetMin(guess) * 60_000)
  return new Date(exact.getTime() - (warsawOffsetMin(exact) - warsawOffsetMin(guess)) * 60_000)
}

export interface TripPlannerOptions {
  supabaseUrl: string
  serviceRoleKey: string
  /** The MOTIS plan endpoint; overridable if Transitous moves to a new API version. */
  transitousUrl?: string
  fetchExternal?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxWaitMs?: number
  timeoutMs?: number
}

export interface TripRequest {
  from: { lat: number; lng: number }
  to: { lat: number; lng: number }
  arriveBy: Date
}

export function createTripPlanner(opts: TripPlannerOptions) {
  const fetchExternal = opts.fetchExternal ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const admin: Db = createClient<Database>(opts.supabaseUrl, opts.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const endpoint = opts.transitousUrl ?? DEFAULT_TRANSITOUS_URL

  /** Waits for the shared Transitous slot; false when the wait would be too long. */
  async function takeSlot(): Promise<boolean> {
    const { data: waitMs, error } = await admin.rpc('claim_fetch_slot', {
      p_domain: new URL(endpoint).host,
      p_interval_ms: TRANSITOUS_INTERVAL_MS,
    })
    if (error) {
      console.error('transit: claim_fetch_slot failed', error.message)
      return false
    }
    if ((waitMs ?? 0) > (opts.maxWaitMs ?? 5000)) return false
    if (waitMs) await sleep(waitMs)
    return true
  }

  async function plan(req: TripRequest): Promise<TripOutcome> {
    const url = new URL(endpoint)
    url.search = new URLSearchParams({
      fromPlace: `${req.from.lat},${req.from.lng}`,
      toPlace: `${req.to.lat},${req.to.lng}`,
      time: req.arriveBy.toISOString(),
      arriveBy: 'true',
    }).toString()
    try {
      const res = await fetchExternal(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.error(`transit: ${url.host} answered ${res.status}: ${body.slice(0, 300)}`)
        return { status: 'error' }
      }
      const parsed = planSchema.safeParse(await res.json())
      if (!parsed.success) {
        console.error(`transit: unexpected response from ${url.host}`, parsed.error.message)
        return { status: 'error' }
      }
      return pickTrip(parsed.data)
    } catch (e) {
      console.error(`transit: ${url.host} request failed`, String(e))
      return { status: 'error' }
    }
  }

  return { admin, takeSlot, plan }
}

export interface TransitEnv extends TripPlannerOptions {
  anonKey: string
  /** Stop starting new lookups after this long; the client asks again for the rest. */
  budgetMs?: number
  maxPairs?: number
}

export interface TransitResponse {
  computed: number
  remaining: number
}

const bodySchema = z.object({
  huntId: z.string().uuid(),
  listingId: z.string().uuid().optional(),
  pinId: z.string().uuid().optional(),
})

/**
 * POST { huntId, listingId?, pinId? } → looks up the hunt's missing listing→pin
 * trips (optionally only for one listing or pin) and stores them. Members only.
 */
export function createTransitHandler(env: TransitEnv) {
  const planner = createTripPlanner(env)

  return withHttp(async (req) => {
    const started = Date.now()
    const authorization = req.headers.get('Authorization')
    if (!authorization) throw new HttpError(401, 'Missing Authorization header')
    const body = bodySchema.safeParse(await req.json().catch(() => null))
    if (!body.success) throw new HttpError(400, 'Invalid request body')
    const { huntId, listingId, pinId } = body.data

    // Membership is checked as the user (RLS); the work itself runs as the service role.
    const asUser: Db = createClient<Database>(env.supabaseUrl, env.anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await asUser.auth.getUser(
      authorization.replace(/^Bearer\s+/i, ''),
    )
    if (userError || !userData.user) throw new HttpError(401, 'Invalid session')
    const { data: hunt } = await asUser.from('hunts').select('id').eq('id', huntId).maybeSingle()
    if (!hunt) throw new HttpError(404, 'Hunt not found')

    const { admin } = planner
    let listingsQuery = admin
      .from('listings')
      .select('id, lat, lng')
      .eq('hunt_id', huntId)
      .not('lat', 'is', null)
      .not('lng', 'is', null)
    if (listingId) listingsQuery = listingsQuery.eq('id', listingId)
    let pinsQuery = admin
      .from('pins')
      .select('id, lat, lng, arrive_weekday, arrive_time')
      .eq('hunt_id', huntId)
    if (pinId) pinsQuery = pinsQuery.eq('id', pinId)
    const [{ data: listings }, { data: pins }] = await Promise.all([listingsQuery, pinsQuery])
    if (!listings?.length || !pins?.length) return json({ computed: 0, remaining: 0 })

    const { data: existing } = await admin
      .from('listing_routes')
      .select('listing_id, pin_id, status, computed_at')
      .in(
        'listing_id',
        listings.map((l) => l.id),
      )
      .in(
        'pin_id',
        pins.map((p) => p.id),
      )
    const known = new Map((existing ?? []).map((r) => [`${r.listing_id}:${r.pin_id}`, r]))
    const due = listings.flatMap((l) =>
      pins
        .filter((p) => {
          const row = known.get(`${l.id}:${p.id}`)
          if (!row) return true
          return row.status === 'error' && Date.now() - Date.parse(row.computed_at) > ERROR_RETRY_MS
        })
        .map((p) => ({ listing: l, pin: p })),
    )

    const maxPairs = env.maxPairs ?? 12
    const budgetMs = env.budgetMs ?? 40_000
    let computed = 0
    for (const { listing, pin } of due) {
      if (computed >= maxPairs || Date.now() - started > budgetMs) break
      if (!(await planner.takeSlot())) break
      const outcome = await planner.plan({
        from: { lat: listing.lat!, lng: listing.lng! },
        to: { lat: pin.lat, lng: pin.lng },
        arriveBy: nextArrival(pin.arrive_weekday, pin.arrive_time),
      })
      const row: RouteRow = {
        listing_id: listing.id,
        pin_id: pin.id,
        status: outcome.status,
        computed_at: new Date().toISOString(),
        ...(outcome.status === 'ok'
          ? {
              duration_min: outcome.durationMin,
              transfers: outcome.transfers,
              walk_min: outcome.walkMin,
              legs: outcome.legs as never,
              departs_at: outcome.departsAt,
              arrives_at: outcome.arrivesAt,
            }
          : {
              duration_min: null,
              transfers: null,
              walk_min: null,
              legs: [],
              departs_at: null,
              arrives_at: null,
            }),
      }
      const { error } = await admin.from('listing_routes').upsert(row)
      if (error) console.error('transit: saving route failed', error.message)
      computed++
    }

    const response: TransitResponse = { computed, remaining: due.length - computed }
    return json(response)
  })
}
