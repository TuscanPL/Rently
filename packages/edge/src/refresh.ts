import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@at/shared/database'
import { hostOf, parseListingHtml } from '@at/parsers'
import { BROWSER_HEADERS, HttpError, json, withHttp } from './http.ts'

type Db = SupabaseClient<Database>

export interface RefreshEnv {
  supabaseUrl: string
  anonKey: string
  /** The cron job has no user, so it reads and writes through security-definer RPCs as service role. */
  serviceRoleKey: string
  /** Shared with the GitHub workflow (header `x-cron-secret`). Unset = cron calls refused. */
  cronSecret?: string
  /** Used for listing pages only; injectable for tests. */
  fetchExternal?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Listings picked per invocation. Each one costs a fetch and a parse, so keep it small. */
  batchSize?: number
  /** No new fetch starts after this long (edge functions get ~150 s of wall clock). */
  timeBudgetMs?: number
  /** Minimum spacing between two requests to one domain. */
  domainIntervalMs?: number
  /** Longest a manual "Check now" waits for its domain's slot before giving up. */
  maxWaitMs?: number
}

export interface RefreshSummary {
  checked: number
  unchanged: number
  priceChanged: number
  removed: number
  restored: number
  unknown: number
  /** Listings still due after this run; the workflow calls again while this is > 0. */
  remaining: number
}

export type CheckOutcome = 'unchanged' | 'price_changed' | 'removed' | 'restored' | 'unknown'

export interface CheckNowResponse extends RefreshSummary {
  outcome: CheckOutcome
}

/** What a fetch of the ad told us. Anything short of a clear answer is `unknown`. */
export type Probe =
  | { result: 'gone'; reason: string }
  | { result: 'unknown'; reason: string }
  | { result: 'alive'; rent: number | null; adminFee: number | null }

const BATCH_SIZE = 20
const TIME_BUDGET_MS = 100_000
const DOMAIN_INTERVAL_MS = 4000
const FETCH_TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 5
const MAX_HTML_BYTES = 5_000_000
/** A parsed rent this far from the stored one is more likely a misparse than a new price. */
const MAX_PRICE_JUMP = 0.6

const checkNowSchema = z.object({ listingId: z.string().uuid() })

export function createRefreshHandler(env: RefreshEnv) {
  const fetchExternal = env.fetchExternal ?? fetch
  const sleep = env.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const admin: Db = createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const ctx: Ctx = {
    admin,
    fetchExternal,
    sleep,
    domainIntervalMs: env.domainIntervalMs ?? DOMAIN_INTERVAL_MS,
  }

  const handle = withHttp(async (req) => {
    const cronHeader = req.headers.get('x-cron-secret')
    if (cronHeader != null) {
      if (!env.cronSecret || cronHeader !== env.cronSecret) throw new HttpError(401, 'Unauthorized')
      return json(
        await runBatch(ctx, env.batchSize ?? BATCH_SIZE, env.timeBudgetMs ?? TIME_BUDGET_MS),
      )
    }
    const authorization = req.headers.get('Authorization')
    if (!authorization) throw new HttpError(401, 'Unauthorized')
    return json(await checkNow(ctx, env, req, authorization))
  })

  // Requests without credentials get a 401 whatever the method, as before: the
  // e2e setup probes the function with a GET to see whether the runtime is up.
  return (req: Request): Promise<Response> => {
    const anonymous = !req.headers.has('x-cron-secret') && !req.headers.has('Authorization')
    if (req.method !== 'OPTIONS' && anonymous) {
      return Promise.resolve(json({ error: 'Unauthorized' }, 401))
    }
    return handle(req)
  }
}

interface Ctx {
  admin: Db
  fetchExternal: typeof fetch
  sleep: (ms: number) => Promise<void>
  domainIntervalMs: number
}

interface Due {
  id: string
  url: string
  rent: number | null
}

function emptySummary(): RefreshSummary {
  return {
    checked: 0,
    unchanged: 0,
    priceChanged: 0,
    removed: 0,
    restored: 0,
    unknown: 0,
    remaining: 0,
  }
}

/**
 * Re-checks the listings that are due, oldest check first. Listings are grouped
 * by domain and the domains run side by side, each waiting for its own fetch
 * slot, so one slow site doesn't hold up the others.
 */
async function runBatch(ctx: Ctx, batchSize: number, budgetMs: number): Promise<RefreshSummary> {
  const started = Date.now()
  const { data: due, error } = await ctx.admin.rpc('listings_due_for_check', {
    p_limit: batchSize,
  })
  if (error) throw new HttpError(500, `Could not load listings: ${error.message}`)

  const summary = emptySummary()
  const byDomain = new Map<string, Due[]>()
  for (const row of due) {
    let domain: string
    try {
      domain = hostOf(new URL(row.url))
    } catch {
      // A URL we can't even parse can't be checked; move it to the back of the queue.
      tally(summary, await record(ctx, row.id, { result: 'unknown', reason: 'bad url' }))
      continue
    }
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), row])
  }

  await Promise.all(
    [...byDomain].map(async ([domain, rows]) => {
      for (const row of rows) {
        const { data: waitMs, error: slotError } = await ctx.admin.rpc('claim_fetch_slot', {
          p_domain: domain,
          p_interval_ms: ctx.domainIntervalMs,
        })
        if (slotError) return
        if (Date.now() + (waitMs ?? 0) - started > budgetMs) return
        if (waitMs) await ctx.sleep(waitMs)
        const probe = await probeListing(ctx.fetchExternal, row)
        tally(summary, await record(ctx, row.id, probe))
      }
    }),
  )

  const totalDue = Number(due[0]?.total_due ?? 0)
  summary.remaining = Math.max(0, totalDue - summary.checked)
  return summary
}

/** "Check now" from the listing page: one listing, as a member of its hunt. */
async function checkNow(
  ctx: Ctx,
  env: RefreshEnv,
  req: Request,
  authorization: string,
): Promise<CheckNowResponse> {
  const user: Db = createClient<Database>(env.supabaseUrl, env.anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await user.auth.getUser(
    authorization.replace(/^Bearer\s+/i, ''),
  )
  if (userError || !userData.user) throw new HttpError(401, 'Invalid session')

  const body = checkNowSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) throw new HttpError(400, 'Invalid request body')

  // Read as the user, so RLS is the membership check.
  const { data: listing } = await user
    .from('listings')
    .select('id, url, rent')
    .eq('id', body.data.listingId)
    .maybeSingle()
  if (!listing) throw new HttpError(404, 'Listing not found')
  if (!listing.url) throw new HttpError(400, 'This listing has no link to check')

  let domain: string
  try {
    domain = hostOf(new URL(listing.url))
  } catch {
    throw new HttpError(400, 'This listing has no link to check')
  }
  const { data: waitMs } = await ctx.admin.rpc('claim_fetch_slot', {
    p_domain: domain,
    p_interval_ms: ctx.domainIntervalMs,
  })
  if ((waitMs ?? 0) > (env.maxWaitMs ?? 8000)) {
    throw new HttpError(429, 'The site was asked a moment ago. Try again in a minute.')
  }
  if (waitMs) await ctx.sleep(waitMs)

  const probe = await probeListing(ctx.fetchExternal, { url: listing.url, rent: listing.rent })
  const outcome = await record(ctx, listing.id, probe)
  const summary = emptySummary()
  tally(summary, outcome)
  return { ...summary, outcome }
}

/** Saves a probe through record_listing_check and says what changed. */
async function record(ctx: Ctx, listingId: string, probe: Probe): Promise<CheckOutcome> {
  // The function logs are where a site that changed its markup shows up first.
  if (probe.result !== 'alive') console.log(`${listingId}: ${probe.result} (${probe.reason})`)
  const { data: events, error } = await ctx.admin.rpc('record_listing_check', {
    p_listing_id: listingId,
    p_result: probe.result,
    ...(probe.result === 'alive'
      ? {
          ...(probe.rent != null && { p_rent: probe.rent }),
          ...(probe.adminFee != null && { p_admin_fee: probe.adminFee }),
        }
      : {}),
  })
  if (error) {
    console.error(`record_listing_check ${listingId}: ${error.message}`)
    return 'unknown'
  }
  if (probe.result === 'unknown') return 'unknown'
  if (events.includes('ad_removed')) return 'removed'
  if (events.includes('ad_restored')) return 'restored'
  if (events.includes('price_changed')) return 'price_changed'
  return 'unchanged'
}

function tally(summary: RefreshSummary, outcome: CheckOutcome) {
  summary.checked++
  if (outcome === 'unchanged') summary.unchanged++
  else if (outcome === 'price_changed') summary.priceChanged++
  else if (outcome === 'removed') summary.removed++
  else if (outcome === 'restored') summary.restored++
  else summary.unknown++
}

// ---------------------------------------------------------------------------
// Deciding gone / alive / unknown
// ---------------------------------------------------------------------------

/** Where each site keeps its ad pages. A redirect anywhere else on the site means the ad is gone. */
const AD_PAGES: { host: RegExp; path: RegExp }[] = [
  { host: /(^|\.)otodom\.pl$/, path: /\/oferta\// },
  { host: /(^|\.)olx\.pl$/, path: /\/oferta\// },
  { host: /(^|\.)gratka\.pl$/, path: /\/ob\/\d+/ },
  { host: /(^|\.)morizon\.pl$/, path: /\/oferta\// },
  { host: /(^|\.)nieruchomosci-online\.pl$/, path: /\/\d+\.html$/ },
  { host: /(^|\.)domiporta\.pl$/, path: /^\/(nieruchomosci\/[^/]+\/\d+|oferta\/\d+)/ },
]

/**
 * 'ad' = an ad page on a site we know; 'index' = a search page, category or
 * home page instead of the ad; 'unclear' = some other page on a site we don't know.
 */
export function classifyLanding(url: URL): 'ad' | 'index' | 'unclear' {
  const host = hostOf(url)
  const site = AD_PAGES.find((s) => s.host.test(host))
  if (site) return site.path.test(url.pathname) ? 'ad' : 'index'
  return url.pathname.replace(/\/+$/, '') === '' ? 'index' : 'unclear'
}

/** "Ogłoszenie nieaktualne", "Oferta wygasła", "To ogłoszenie nie jest już dostępne"… */
const GONE_MARKERS = [
  /ogłoszenie\s+(jest\s+)?(już\s+)?(nieaktualne|wygasło|zakończone|archiwalne)/i,
  /ogłoszenie\s+(zostało\s+)?(zakończone|usunięte|wycofane|dezaktywowane)/i,
  /oferta\s+(jest\s+)?(już\s+)?(nieaktualna|wygasła|zakończona|archiwalna)/i,
  /oferta\s+(została\s+)?(zakończona|usunięta|wycofana)/i,
  /(ogłoszenie|oferta)\s+nie\s+jest\s+już\s+dostępn[ea]/i,
]

/** Visible text of a page: no scripts, styles or tags. */
function visibleText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
}

export function hasGoneMarker(text: string): boolean {
  return GONE_MARKERS.some((re) => re.test(text))
}

/**
 * Fetches the ad and decides:
 *   gone    404/410, a redirect to a search or index page, or an "ad expired" notice
 *   alive   the page still parses as a listing
 *   unknown everything else: network errors, timeouts, 403/429/5xx, bot walls,
 *           pages we don't recognise. Never marked gone on a guess.
 * Prices are only reported when the parse is confident.
 */
export async function probeListing(
  fetchExternal: typeof fetch,
  listing: { url: string; rent: number | null },
): Promise<Probe> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  let url = new URL(listing.url)
  let res: Response | undefined
  for (let hop = 0; ; hop++) {
    try {
      res = await fetchExternal(url, { headers: BROWSER_HEADERS, redirect: 'manual', signal })
    } catch (e) {
      return { result: 'unknown', reason: `network: ${(e as Error).message}` }
    }
    if (res.status < 300 || res.status >= 400) break
    const location = res.headers.get('location')
    await res.body?.cancel()
    if (!location || hop >= MAX_REDIRECTS) return { result: 'unknown', reason: 'redirect' }
    try {
      url = new URL(location, url)
    } catch {
      return { result: 'unknown', reason: 'bad redirect' }
    }
    if (classifyLanding(url) === 'index') {
      return { result: 'gone', reason: `redirected to ${url.pathname}` }
    }
  }

  if (res.status === 404 || res.status === 410) {
    await res.body?.cancel()
    return { result: 'gone', reason: `http ${res.status}` }
  }
  // 403/429 are usually bot protection; 5xx and opaque responses say nothing about the ad.
  if (!res.ok) {
    await res.body?.cancel()
    return { result: 'unknown', reason: `http ${res.status}` }
  }
  if (!/html/i.test(res.headers.get('content-type') ?? 'text/html')) {
    await res.body?.cancel()
    return { result: 'unknown', reason: 'not html' }
  }
  let html: string
  try {
    html = await res.text()
  } catch (e) {
    return { result: 'unknown', reason: `network: ${(e as Error).message}` }
  }
  if (html.length > MAX_HTML_BYTES) return { result: 'unknown', reason: 'page too large' }

  const parsed = parseListingHtml(html, url)
  const { listing: ad, confidence } = parsed
  // A landlord's own words in the description ("oferta nieaktualna po 1.12") don't count.
  if (hasGoneMarker(visibleText(html)) && !hasGoneMarker(ad.description ?? '')) {
    return { result: 'gone', reason: 'expired notice' }
  }
  // We followed redirects to a page on a site we don't know: can't tell what it is.
  if (url.toString() !== new URL(listing.url).toString() && classifyLanding(url) === 'unclear') {
    return { result: 'unknown', reason: 'redirected' }
  }
  // Bot walls and error pages that answer 200 don't parse as a listing.
  if (ad.rent == null && confidence < 0.5) return { result: 'unknown', reason: 'not a listing' }

  const stored = listing.rent == null ? null : Number(listing.rent)
  const confident =
    ad.rent != null &&
    confidence >= 0.5 &&
    (stored == null || Math.abs(ad.rent - stored) <= stored * MAX_PRICE_JUMP)
  return {
    result: 'alive',
    rent: confident ? ad.rent! : null,
    adminFee: confident ? (ad.adminFee ?? null) : null,
  }
}
