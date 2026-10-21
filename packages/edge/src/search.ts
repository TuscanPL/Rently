import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@at/shared/database'
import { hostOf, otodomSearchPageUrl, parseOtodomSearch, type SearchItem } from '@at/parsers'
import { BROWSER_HEADERS, HttpError, json, withHttp } from './http.ts'

type Db = SupabaseClient<Database>
type ResultRow = Database['public']['Tables']['search_results']['Insert']

// Refreshes one saved Otodom search when a member asks (pull to refresh in
// Browse). Never scheduled: one tap reads at most a few result pages, spaced
// out through the same per-site throttle as adding a listing.

const SITE_INTERVAL_MS = 4000
/** A refresh within this long of the last one returns the stored results. */
const MIN_REFRESH_GAP_MS = 60_000

export interface SearchEnv {
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
  fetchExternal?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Result pages read per refresh. */
  maxPages?: number
  maxWaitMs?: number
  now?: () => Date
}

export interface SearchRefreshResponse {
  /** False when the search was refreshed moments ago and nothing was fetched. */
  refreshed: boolean
  /** Ads currently in the results (on the pages read). */
  total: number
  /** Ads seen for the first time in this refresh. */
  newCount: number
  pages: number
  /** Otodom's own count of results, which can exceed what we read. */
  totalResults: number | null
}

const bodySchema = z.object({ searchId: z.string().uuid() })

/** "2026-10-18 09:00:00" (Otodom, Warsaw time) → ISO; the day is what matters here. */
function postedAt(value: string | null): string | null {
  if (!value) return null
  const iso = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}+01:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function createSearchHandler(env: SearchEnv) {
  const fetchExternal = env.fetchExternal ?? fetch
  const sleep = env.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const now = env.now ?? (() => new Date())
  const admin: Db = createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  async function fetchPage(url: string): Promise<string> {
    const { data: waitMs, error } = await admin.rpc('claim_fetch_slot', {
      p_domain: hostOf(new URL(url)),
      p_interval_ms: SITE_INTERVAL_MS,
    })
    if (error) throw new HttpError(503, 'Otodom is busy, try again in a moment')
    if ((waitMs ?? 0) > (env.maxWaitMs ?? 10_000)) {
      throw new HttpError(503, 'Otodom is busy, try again in a moment')
    }
    if (waitMs) await sleep(waitMs)
    let res: Response
    try {
      res = await fetchExternal(url, {
        headers: BROWSER_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      })
    } catch (e) {
      console.error('search: request failed', String(e))
      throw new HttpError(502, "Couldn't reach Otodom")
    }
    if (!res.ok) {
      console.error(`search: Otodom answered ${res.status} for ${url}`)
      throw new HttpError(502, `Otodom answered ${res.status}`)
    }
    return res.text()
  }

  return withHttp(async (req) => {
    const authorization = req.headers.get('Authorization')
    if (!authorization) throw new HttpError(401, 'Missing Authorization header')
    const body = bodySchema.safeParse(await req.json().catch(() => null))
    if (!body.success) throw new HttpError(400, 'Invalid request body')

    // Reading the search as the user is the membership check.
    const asUser: Db = createClient<Database>(env.supabaseUrl, env.anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await asUser.auth.getUser(
      authorization.replace(/^Bearer\s+/i, ''),
    )
    if (userError || !userData.user) throw new HttpError(401, 'Invalid session')
    const { data: search } = await asUser
      .from('saved_searches')
      .select('*')
      .eq('id', body.data.searchId)
      .maybeSingle()
    if (!search) throw new HttpError(404, 'Search not found')

    const started = now()
    if (
      search.last_refreshed_at &&
      started.getTime() - Date.parse(search.last_refreshed_at) < MIN_REFRESH_GAP_MS
    ) {
      const { count } = await admin
        .from('search_results')
        .select('external_id', { count: 'exact', head: true })
        .eq('search_id', search.id)
        .gte('last_seen_at', search.last_refreshed_at)
      const response: SearchRefreshResponse = {
        refreshed: false,
        total: count ?? 0,
        newCount: 0,
        pages: 0,
        totalResults: search.last_total,
      }
      return json(response)
    }

    const items = new Map<string, SearchItem>()
    let pages = 0
    let totalPages = 1
    let totalResults: number | null = null
    try {
      for (let page = 1; page <= Math.min(totalPages, env.maxPages ?? 3); page++) {
        const html = await fetchPage(otodomSearchPageUrl(search.url, page))
        const parsed = parseOtodomSearch(html, search.url)
        pages++
        if (page === 1) {
          totalPages = parsed.totalPages
          totalResults = parsed.totalResults
          if (parsed.items.length === 0 && !html.includes('__NEXT_DATA__')) {
            console.error('search: no result data on the page', html.slice(0, 300))
            throw new HttpError(502, "Otodom didn't send search results")
          }
        }
        for (const item of parsed.items)
          if (!items.has(item.externalId)) items.set(item.externalId, item)
      }
    } catch (e) {
      const message = e instanceof HttpError ? e.message : 'Refresh failed'
      await admin.from('saved_searches').update({ last_error: message }).eq('id', search.id)
      throw e
    }

    const seenAt = started.toISOString()
    const { data: known } = await admin
      .from('search_results')
      .select('external_id')
      .eq('search_id', search.id)
      .in('external_id', [...items.keys()])
    const knownIds = new Set((known ?? []).map((r) => r.external_id))
    const rows: ResultRow[] = [...items.values()].map((i) => ({
      search_id: search.id,
      hunt_id: search.hunt_id,
      external_id: i.externalId,
      url: i.url,
      title: i.title,
      rent: i.rent,
      admin_fee: i.adminFee,
      area_m2: i.areaM2,
      rooms: i.rooms,
      floor: i.floor,
      district: i.district,
      address: i.address,
      private_owner: i.privateOwner,
      photos: i.photos,
      posted_at: postedAt(i.postedAt),
      last_seen_at: seenAt,
      // first_seen_at keeps its default on insert and isn't sent, so an update keeps it.
    }))
    if (rows.length) {
      const { error } = await admin.from('search_results').upsert(rows)
      if (error) throw new HttpError(500, `Could not save results: ${error.message}`)
      // Ads seen before keep their first_seen_at; new ones get this refresh's time.
      const fresh = rows.filter((r) => !knownIds.has(r.external_id)).map((r) => r.external_id)
      if (fresh.length) {
        await admin
          .from('search_results')
          .update({ first_seen_at: seenAt })
          .eq('search_id', search.id)
          .in('external_id', fresh)
      }
    }
    await admin
      .from('saved_searches')
      .update({
        last_refreshed_at: seenAt,
        first_refreshed_at: search.first_refreshed_at ?? seenAt,
        last_total: totalResults,
        last_error: null,
      })
      .eq('id', search.id)

    const response: SearchRefreshResponse = {
      refreshed: true,
      total: rows.length,
      newCount: rows.filter((r) => !knownIds.has(r.external_id)).length,
      pages,
      totalResults,
    }
    return json(response)
  })
}
