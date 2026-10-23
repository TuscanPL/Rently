import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@at/shared/database'
import { geocodeQuery, type ParsedListing } from '@at/shared'
import {
  buildResult,
  canonicalizeUrl,
  extractFromText,
  hostOf,
  parseListingHtml,
  resultFromUrlOnly,
  sanitizeListing,
  sourceForUrl,
  type ParseResult,
} from '@at/parsers'
import { BROWSER_HEADERS, HttpError, json, withHttp } from './http.ts'
import type { Geocoder } from './geocode.ts'

type Db = SupabaseClient<Database>
type ListingInsert = Database['public']['Tables']['listings']['Insert']

export interface IngestEnv {
  supabaseUrl: string
  anonKey: string
  /** Used for listing pages and cover images only; injectable for tests. */
  fetchExternal?: typeof fetch
  /** Longest we'll wait for a domain's rate-limit slot before saving without fetching. */
  maxWaitMs?: number
  sleep?: (ms: number) => Promise<void>
  /** Puts listings that come without coordinates on the map from their address. */
  geocode?: Geocoder
}

const MAX_HTML_BYTES = 5_000_000
const MAX_COVER_BYTES = 400_000
const DOMAIN_INTERVAL_MS = 3000
const DETAIL_FIELDS = ['rent', 'areaM2', 'rooms'] as const

const bodySchema = z.object({
  huntId: z.string().uuid(),
  url: z.string().url().optional(),
  /** Already parsed by the extension on the live page. */
  parsed: z.record(z.string(), z.unknown()).optional(),
  /** Free text (Facebook post etc.), with fields the user confirmed and uploaded photo paths. */
  text: z.string().max(20_000).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  photoPaths: z.array(z.string()).max(30).optional(),
  /** Where `parsed` came from: the extension (default) or a Browse result read by search-refresh. */
  via: z.enum(['extension', 'browse']).optional(),
  /** "Add as liked": also record the adder's yes. */
  liked: z.boolean().optional(),
})
type IngestBody = z.infer<typeof bodySchema>

export interface IngestResponse {
  listingId: string
  existing: boolean
  needsDetails: boolean
  missingFields: string[]
  confidence: number
  fetched: boolean
  possibleDuplicates: { id: string; title: string | null }[]
}

export function createIngestHandler(env: IngestEnv) {
  const fetchExternal = env.fetchExternal ?? fetch
  const sleep = env.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  return withHttp(async (req) => {
    const authorization = req.headers.get('Authorization')
    if (!authorization) throw new HttpError(401, 'Missing Authorization header')
    // Every query runs as the user, so RLS decides what they may touch.
    const db: Db = createClient<Database>(env.supabaseUrl, env.anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await db.auth.getUser(
      authorization.replace(/^Bearer\s+/i, ''),
    )
    if (userError || !userData.user) throw new HttpError(401, 'Invalid session')

    const parsedBody = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsedBody.success) throw new HttpError(400, 'Invalid request body')
    const body = parsedBody.data

    const { data: hunt } = await db
      .from('hunts')
      .select('id, city')
      .eq('id', body.huntId)
      .maybeSingle()
    if (!hunt) throw new HttpError(404, 'Hunt not found')

    const ctx = { db, body, userId: userData.user.id, city: hunt.city, fetchExternal, sleep, env }
    if (body.text != null) return json(await ingestText(ctx))
    if (body.parsed) return json(await ingestParsed(ctx))
    if (body.url) return json(await ingestUrl(ctx))
    throw new HttpError(400, 'Provide url, parsed or text')
  })
}

interface Ctx {
  db: Db
  body: IngestBody
  userId: string
  city: string
  fetchExternal: typeof fetch
  sleep: (ms: number) => Promise<void>
  env: IngestEnv
}

async function findExisting(ctx: Ctx, canonicalUrl: string) {
  const { data } = await ctx.db
    .from('listings')
    .select('id, needs_details')
    .eq('hunt_id', ctx.body.huntId)
    .eq('canonical_url', canonicalUrl)
    .maybeSingle()
  if (data) return data
  // An ad that was merged into another listing finds the kept one. The element is
  // quoted because canonical URLs can contain commas (nieruchomosci-online).
  const { data: merged } = await ctx.db
    .from('listings')
    .select('id, needs_details')
    .eq('hunt_id', ctx.body.huntId)
    .filter('merged_urls', 'cs', `{"${canonicalUrl.replace(/["\\]/g, '\\$&')}"}`)
    .limit(1)
    .maybeSingle()
  return merged
}

/** "Add as liked" records the adder's yes; a plain add leaves the listing in their deck. */
async function likeIt(ctx: Ctx, listingId: string) {
  if (!ctx.body.liked) return
  const { error } = await ctx.db
    .from('votes')
    .upsert({ listing_id: listingId, user_id: ctx.userId, swipe: 'yes', stars: null })
  if (error) console.error('ingest: could not record the vote', error.message)
}

async function existingResponse(
  ctx: Ctx,
  row: { id: string; needs_details: boolean },
): Promise<IngestResponse> {
  await likeIt(ctx, row.id)
  return {
    listingId: row.id,
    existing: true,
    needsDetails: row.needs_details,
    missingFields: [],
    confidence: 1,
    fetched: false,
    possibleDuplicates: [],
  }
}

async function ingestUrl(ctx: Ctx): Promise<IngestResponse> {
  let url = new URL(ctx.body.url!)
  let canonical = canonicalizeUrl(url.toString())
  const known = await findExisting(ctx, canonical)
  if (known) return existingResponse(ctx, known)

  let result: ParseResult | undefined
  let fetched = false
  const page = await fetchPage(ctx, url)
  if (page) {
    fetched = true
    // Short links and OLX→Otodom redirects: dedup on where we actually landed.
    if (page.finalUrl.toString() !== url.toString()) {
      url = page.finalUrl
      canonical = canonicalizeUrl(url.toString())
      const landed = await findExisting(ctx, canonical)
      if (landed) return existingResponse(ctx, landed)
    }
    result = parseListingHtml(page.html, url)
  }
  result ??= resultFromUrlOnly(url)
  return saveListing(ctx, result, { url: ctx.body.url!, canonical, method: 'url', fetched })
}

async function ingestParsed(ctx: Ctx): Promise<IngestResponse> {
  const raw = ctx.body.parsed!
  const url = new URL(String(raw.url ?? ctx.body.url ?? ''))
  const canonical = canonicalizeUrl(url.toString())
  const known = await findExisting(ctx, canonical)
  if (known) return existingResponse(ctx, known)
  const result = buildResult(url, raw as Partial<ParsedListing>)
  return saveListing(ctx, result, {
    url: url.toString(),
    canonical,
    method: ctx.body.via ?? 'extension',
    fetched: false,
  })
}

async function ingestText(ctx: Ctx): Promise<IngestResponse> {
  const { text = '', fields = {}, url } = ctx.body
  const listing = { ...sanitizeListing(extractFromText(text)), ...sanitizeListing(fields as never) }
  if (!listing.description && text.trim()) listing.description = text.trim()
  const source = url ? sourceForUrl(url) : 'facebook'
  const canonical = url ? canonicalizeUrl(url) : null
  if (canonical) {
    const known = await findExisting(ctx, canonical)
    if (known) return existingResponse(ctx, known)
  }
  const missingFields = DETAIL_FIELDS.filter((f) => listing[f] == null)
  const result: ParseResult = {
    listing: { ...listing, source: listing.source ?? source, url: url ?? 'https://facebook.com/' },
    confidence: 1 - missingFields.length / DETAIL_FIELDS.length,
    missingFields,
  }
  return saveListing(ctx, result, { url: url ?? null, canonical, method: 'text', fetched: false })
}

async function fetchPage(ctx: Ctx, url: URL): Promise<{ html: string; finalUrl: URL } | undefined> {
  const { data: waitMs } = await ctx.db.rpc('claim_fetch_slot', {
    p_domain: hostOf(url),
    p_interval_ms: DOMAIN_INTERVAL_MS,
  })
  if ((waitMs ?? 0) > (ctx.env.maxWaitMs ?? 8000)) return undefined
  if (waitMs) await ctx.sleep(waitMs)
  try {
    const res = await ctx.fetchExternal(url, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok || !/html/i.test(res.headers.get('content-type') ?? 'text/html')) return undefined
    const html = await res.text()
    if (html.length > MAX_HTML_BYTES) return undefined
    return { html, finalUrl: new URL(res.url || url.toString()) }
  } catch {
    return undefined
  }
}

function toRow(
  huntId: string,
  userId: string,
  r: ParseResult,
  url: string | null,
  canonical: string | null,
): ListingInsert {
  const l = r.listing
  return {
    hunt_id: huntId,
    added_by: userId,
    source: l.source,
    url,
    canonical_url: canonical,
    title: l.title ?? null,
    description: l.description ?? null,
    rent: l.rent ?? null,
    admin_fee: l.adminFee ?? null,
    utilities_estimate: l.utilitiesEstimate ?? null,
    deposit: l.deposit ?? null,
    area_m2: l.areaM2 ?? null,
    rooms: l.rooms ?? null,
    floor: l.floor ?? null,
    total_floors: l.totalFloors ?? null,
    address: l.address ?? null,
    district: l.district ?? null,
    lat: l.lat ?? null,
    lng: l.lng ?? null,
    available_from: l.availableFrom ?? null,
    advertiser_type: l.advertiserType ?? 'unknown',
    features: l.features ?? {},
    raw: (r.raw ?? null) as never,
    parse_confidence: r.confidence,
    needs_details: DETAIL_FIELDS.some((f) => l[f] == null),
  }
}

async function saveListing(
  ctx: Ctx,
  result: ParseResult,
  opts: { url: string | null; canonical: string | null; method: string; fetched: boolean },
): Promise<IngestResponse> {
  const { db, body, userId } = ctx
  const row = toRow(body.huntId, userId, result, opts.url, opts.canonical)
  const { data: inserted, error } = await db.from('listings').insert(row).select('id').single()
  if (error) {
    // Someone added the same ad a moment ago.
    if (error.code === '23505' && opts.canonical) {
      const known = await findExisting(ctx, opts.canonical)
      if (known) return existingResponse(ctx, known)
    }
    throw new HttpError(500, `Could not save listing: ${error.message}`)
  }
  const listingId = inserted.id

  await savePhotos(ctx, listingId, result.listing)
  if (row.lat == null && (row.address || row.district)) await locate(ctx, listingId, row)
  await Promise.all([
    db.from('listing_events').insert({
      listing_id: listingId,
      user_id: userId,
      type: 'added',
      payload: { method: opts.method, confidence: result.confidence, fetched: opts.fetched },
    }),
    row.rent != null &&
      db
        .from('listing_price_history')
        .insert({ listing_id: listingId, rent: row.rent, admin_fee: row.admin_fee }),
  ])

  await likeIt(ctx, listingId)

  const { data: dupes } = await db.rpc('listing_possible_duplicates', { p_listing_id: listingId })
  return {
    listingId,
    existing: false,
    needsDetails: row.needs_details ?? false,
    missingFields: result.missingFields,
    confidence: result.confidence,
    fetched: opts.fetched,
    possibleDuplicates: (dupes ?? []).map((d) => ({ id: d.id, title: d.title })),
  }
}

/** Geocodes "address, district, city" for a listing saved without coordinates. Best effort. */
async function locate(ctx: Ctx, listingId: string, row: ListingInsert) {
  if (!ctx.env.geocode) return
  const outcome = await ctx.env
    .geocode(geocodeQuery(row.address, row.district, ctx.city))
    .catch(() => null)
  if (outcome?.status !== 'found') return
  await ctx.db.from('listings').update({ lat: outcome.lat, lng: outcome.lng }).eq('id', listingId)
}

async function savePhotos(ctx: Ctx, listingId: string, listing: ParsedListing) {
  const { db, body } = ctx
  const uploaded = (body.photoPaths ?? []).filter((p) => p.startsWith(`${body.huntId}/`))
  if (uploaded.length) {
    await db.from('listing_photos').insert(
      uploaded.map((storage_path, position) => ({
        listing_id: listingId,
        storage_path,
        position,
        is_cover: position === 0,
      })),
    )
    return
  }

  const photos = listing.photos ?? []
  const coverSource = listing.coverThumbnailUrl ?? photos[0]
  const coverPath = coverSource ? await cacheCover(ctx, listingId, coverSource) : undefined
  const rows = photos.map((original_url, position) => ({
    listing_id: listingId,
    original_url,
    position,
    is_cover: position === 0,
    storage_path: position === 0 ? (coverPath ?? null) : null,
  }))
  if (rows.length === 0 && coverPath) {
    rows.push({
      listing_id: listingId,
      original_url: coverSource!,
      position: 0,
      is_cover: true,
      storage_path: coverPath,
    })
  }
  if (rows.length) await db.from('listing_photos').insert(rows)
}

/**
 * Downloads the small cover variant once (no re-encoding) so the card stays
 * recognisable after the ad is taken down. Failures are ignored.
 */
async function cacheCover(ctx: Ctx, listingId: string, src: string): Promise<string | undefined> {
  try {
    const res = await ctx.fetchExternal(src, {
      headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'], Accept: 'image/webp,image/*' },
      signal: AbortSignal.timeout(10_000),
    })
    const type = res.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
    if (!res.ok || !/^image\/(jpeg|png|webp|avif)$/.test(type)) return undefined
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_COVER_BYTES) return undefined
    const ext = type.split('/')[1]!.replace('jpeg', 'jpg')
    const path = `${ctx.body.huntId}/${listingId}/cover.${ext}`
    const { error } = await ctx.db.storage
      .from('listing-photos')
      .upload(path, bytes, { contentType: type, upsert: true })
    return error ? undefined : path
  } catch {
    return undefined
  }
}
