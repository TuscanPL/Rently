import type { ParseResult, SiteAdapter } from './types.ts'
import { buildResult, mergeResults } from './result.ts'
import { genericAdapter } from './adapters/generic.ts'
import { otodomAdapter } from './adapters/otodom.ts'
import { olxAdapter } from './adapters/olx.ts'
import { gratkaAdapter } from './adapters/gratka.ts'
import { morizonAdapter } from './adapters/morizon.ts'
import { nieruchomosciOnlineAdapter } from './adapters/nieruchomosci-online.ts'
import { domiportaAdapter } from './adapters/domiporta.ts'
import { titleFromUrl } from './url.ts'

export type { ParseResult, SiteAdapter, TextExtractor, ImportantField } from './types.ts'
export { IMPORTANT_FIELDS } from './types.ts'
export { extractFromText } from './text.ts'
export { canonicalizeUrl, sourceForUrl, firstUrl, titleFromUrl, hostOf } from './url.ts'
export { buildResult, sanitize as sanitizeListing } from './result.ts'
export {
  isOtodomSearchUrl,
  otodomSearchPageUrl,
  parseOtodomSearch,
  type SearchItem,
  type SearchPage,
} from './search/otodom.ts'

export const ADAPTERS: SiteAdapter[] = [
  otodomAdapter,
  olxAdapter,
  gratkaAdapter,
  morizonAdapter,
  nieruchomosciOnlineAdapter,
  domiportaAdapter,
]

function attempt(adapter: SiteAdapter, html: string, url: URL): ParseResult | undefined {
  try {
    return adapter.parse(html, url)
  } catch {
    return undefined
  }
}

/** What we know about a listing when its page couldn't be fetched or parsed at all. */
export function resultFromUrlOnly(url: string | URL): ParseResult {
  const u = typeof url === 'string' ? new URL(url) : url
  return buildResult(u, { title: titleFromUrl(u.toString()) })
}

/**
 * Parses a listing page with the site's adapter, filling gaps from the generic
 * one. Never throws: the worst case is a URL-only result with confidence 0.
 */
export function parseListingHtml(html: string, url: string | URL): ParseResult {
  const u = typeof url === 'string' ? new URL(url) : url
  const generic = attempt(genericAdapter, html, u)
  const site = ADAPTERS.find((a) => a.matches(u))
  const specific = site ? attempt(site, html, u) : undefined
  const result = specific && generic ? mergeResults(u, specific, generic) : (specific ?? generic)
  if (!result) return resultFromUrlOnly(u)
  if (!result.listing.title) return mergeResults(u, result, resultFromUrlOnly(u))
  return result
}
