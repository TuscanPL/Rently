import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@at/shared/database'
import { geocodeQuery } from '@at/shared'
import { HttpError, json, withHttp } from './http.ts'

type Db = SupabaseClient<Database>

export const NOMINATIM_HOST = 'nominatim.openstreetmap.org'
// Nominatim's usage policy: at most 1 request per second, and an identifying User-Agent.
const NOMINATIM_INTERVAL_MS = 1100
// Nominatim answers Supabase's edge network with 403, so deployed functions use
// LocationIQ: the same API and response shape, with a key. Free tier: 2 requests a second.
export const LOCATIONIQ_HOST = 'eu1.locationiq.com'
const LOCATIONIQ_INTERVAL_MS = 600
const USER_AGENT = 'ApartmentTogether/1.0 (shared apartment-hunting app; user-entered addresses)'
const HIT_TTL_MS = 180 * 24 * 3600_000
// Misses are cached briefly so a repeated junk query doesn't hit Nominatim every time.
const MISS_TTL_MS = 24 * 3600_000

export interface GeocodeHit {
  lat: number
  lng: number
  displayName: string
}

export type GeocodeOutcome =
  | ({ status: 'found'; cached: boolean } & GeocodeHit)
  | { status: 'not_found'; cached: boolean }
  /** Rate limited, timed out or Nominatim errored. Not cached; try again later. */
  | { status: 'unavailable' }

export interface GeocoderOptions {
  supabaseUrl: string
  /** The cache and the shared throttle are written with the service role only. */
  serviceRoleKey: string
  /** Sent as Nominatim's `email` parameter, per its usage policy. */
  nominatimEmail?: string
  /** When set, look addresses up on LocationIQ instead of Nominatim. */
  locationIqKey?: string
  /** Injectable for tests: OpenStreetMap isn't reachable from CI. */
  fetchExternal?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Longest we'll wait for a Nominatim slot before giving up. */
  maxWaitMs?: number
  timeoutMs?: number
}

export type Geocoder = (query: string) => Promise<GeocodeOutcome>

/** Cache key: case, spacing and trailing punctuation don't make a new query. */
export function normalizeQuery(q: string): string {
  return q
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/^[\s,.;]+|[\s,.;]+$/g, '')
}

const nominatimSchema = z.array(
  z.object({ lat: z.coerce.number(), lon: z.coerce.number(), display_name: z.string() }),
)

export function createGeocoder(opts: GeocoderOptions): Geocoder {
  const fetchExternal = opts.fetchExternal ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const provider = opts.locationIqKey
    ? { host: LOCATIONIQ_HOST, path: '/v1/search', interval: LOCATIONIQ_INTERVAL_MS }
    : { host: NOMINATIM_HOST, path: '/search', interval: NOMINATIM_INTERVAL_MS }
  const admin: Db = createClient<Database>(opts.supabaseUrl, opts.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return async (query) => {
    const key = normalizeQuery(query)
    if (key.length < 2) return { status: 'not_found', cached: false }

    const { data: row } = await admin
      .from('geocode_cache')
      .select('*')
      .eq('query', key)
      .maybeSingle()
    if (row) {
      const age = Date.now() - new Date(row.created_at).getTime()
      if (row.lat != null && row.lng != null && age < HIT_TTL_MS) {
        return {
          status: 'found',
          cached: true,
          lat: row.lat,
          lng: row.lng,
          displayName: row.display_name ?? '',
        }
      }
      if (row.lat == null && age < MISS_TTL_MS) return { status: 'not_found', cached: true }
    }

    const { data: waitMs, error } = await admin.rpc('claim_fetch_slot', {
      p_domain: provider.host,
      p_interval_ms: provider.interval,
    })
    if (error) console.error('geocode: claim_fetch_slot failed', error.message)
    if (error || (waitMs ?? 0) > (opts.maxWaitMs ?? 5000)) return { status: 'unavailable' }
    if (waitMs) await sleep(waitMs)

    const url = new URL(`https://${provider.host}${provider.path}`)
    url.search = new URLSearchParams({
      ...(opts.locationIqKey ? { key: opts.locationIqKey } : {}),
      q: key,
      // LocationIQ rejects Nominatim's jsonv2 with a 400; plain json has the same fields we read.
      format: opts.locationIqKey ? 'json' : 'jsonv2',
      limit: '1',
      countrycodes: 'pl',
      'accept-language': 'pl',
      ...(opts.nominatimEmail ? { email: opts.nominatimEmail } : {}),
    }).toString()

    let hit: GeocodeHit | null
    try {
      const res = await fetchExternal(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      })
      // LocationIQ answers "no match" with a 404 instead of an empty list.
      if (res.status === 404 && opts.locationIqKey) {
        hit = null
      } else {
        if (!res.ok) {
          console.error(`geocode: ${provider.host} answered ${res.status}`)
          return { status: 'unavailable' }
        }
        const parsed = nominatimSchema.safeParse(await res.json())
        if (!parsed.success) {
          console.error(`geocode: unexpected response from ${provider.host}`)
          return { status: 'unavailable' }
        }
        const first = parsed.data[0]
        hit = first ? { lat: first.lat, lng: first.lon, displayName: first.display_name } : null
      }
    } catch (e) {
      console.error(`geocode: ${provider.host} request failed`, String(e))
      return { status: 'unavailable' }
    }

    await admin.from('geocode_cache').upsert({
      query: key,
      lat: hit?.lat ?? null,
      lng: hit?.lng ?? null,
      display_name: hit?.displayName ?? null,
      created_at: new Date().toISOString(),
    })
    return hit ? { status: 'found', cached: false, ...hit } : { status: 'not_found', cached: false }
  }
}

export interface GeocodeEnv extends GeocoderOptions {
  anonKey: string
}

export type GeocodeResponse =
  ({ found: true; cached: boolean } & GeocodeHit) | { found: false; cached: boolean }

const bodySchema = z.object({
  q: z.string().trim().min(2).max(200),
  /** Appended unless the query already names it, e.g. the hunt's city. */
  city: z.string().trim().max(100).optional(),
})

/** POST { q, city? } → the first Nominatim match in Poland, cached. Signed-in users only. */
export function createGeocodeHandler(env: GeocodeEnv) {
  const geocode = createGeocoder(env)

  return withHttp(async (req) => {
    const authorization = req.headers.get('Authorization')
    if (!authorization) throw new HttpError(401, 'Missing Authorization header')
    const db: Db = createClient<Database>(env.supabaseUrl, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await db.auth.getUser(
      authorization.replace(/^Bearer\s+/i, ''),
    )
    if (userError || !userData.user) throw new HttpError(401, 'Invalid session')

    const body = bodySchema.safeParse(await req.json().catch(() => null))
    if (!body.success) throw new HttpError(400, 'Invalid request body')

    const outcome = await geocode(geocodeQuery(body.data.q, body.data.city))
    if (outcome.status === 'unavailable') {
      throw new HttpError(503, 'Geocoding is busy, try again in a moment')
    }
    const response: GeocodeResponse =
      outcome.status === 'found'
        ? {
            found: true,
            cached: outcome.cached,
            lat: outcome.lat,
            lng: outcome.lng,
            displayName: outcome.displayName,
          }
        : { found: false, cached: outcome.cached }
    return json(response)
  })
}
