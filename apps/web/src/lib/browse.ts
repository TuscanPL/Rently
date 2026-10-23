import { canonicalizeUrl } from '@at/parsers'
import { totalMonthly, type ParsedListing } from '@at/shared'
import type { Tables } from './supabase'

export type SavedSearch = Tables<'saved_searches'>
export type SearchResult = Tables<'search_results'>

/** Listed for the first time within this long counts as new. */
const NEW_FOR_MS = 24 * 3600_000

/** In the latest refresh (ads that dropped out of the results are kept but not shown). */
export function isCurrent(result: SearchResult, search: SavedSearch): boolean {
  return !!search.last_refreshed_at && result.last_seen_at >= search.last_refreshed_at
}

/** Turned up in a refresh after the first one, recently. */
export function isNew(result: SearchResult, search: SavedSearch, now = Date.now()): boolean {
  if (!search.first_refreshed_at) return false
  const first = Date.parse(result.first_seen_at)
  return first > Date.parse(search.first_refreshed_at) + 1000 && now - first < NEW_FOR_MS
}

/** The full ad once someone has opened it, else null. */
export function resultDetail(r: Pick<SearchResult, 'detail'>): ParsedListing | null {
  return (r.detail as ParsedListing | null) ?? null
}

/** Every photo of the ad once its full ad is loaded; until then the few the results list has. */
export function resultPhotos(r: Pick<SearchResult, 'detail' | 'photos'>): string[] {
  const full = resultDetail(r)?.photos
  return full?.length ? full : r.photos
}

export function resultTotal(r: Pick<SearchResult, 'rent' | 'admin_fee'>) {
  return totalMonthly({ rent: r.rent, adminFee: r.admin_fee })
}

/** Canonical URLs of the hunt's listings, merged duplicates included. */
export function huntUrls(
  listings: { canonical_url: string | null; merged_urls?: string[] | null }[],
): Set<string> {
  const urls = new Set<string>()
  for (const l of listings) {
    if (l.canonical_url) urls.add(l.canonical_url)
    for (const u of l.merged_urls ?? []) urls.add(u)
  }
  return urls
}

export function inHunt(result: SearchResult, urls: Set<string>): boolean {
  try {
    return urls.has(canonicalizeUrl(result.url))
  } catch {
    return false
  }
}

/** Newest first; ads without a date go last. */
export function sortResults(results: SearchResult[]): SearchResult[] {
  return [...results].sort(
    (a, b) =>
      (b.posted_at ?? '').localeCompare(a.posted_at ?? '') ||
      a.external_id.localeCompare(b.external_id),
  )
}

export function relativeTime(iso: string, locale = 'en', now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const abs = Math.abs(seconds)
  if (abs < 60) return rtf.format(Math.round(seconds), 'second')
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour')
  return rtf.format(Math.round(seconds / 86400), 'day')
}
