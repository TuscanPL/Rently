import { formatArea, formatPLN, totalMonthly } from '@at/shared'
import type { ParseResult } from '@at/parsers'

/** What ingest-listing answers (packages/edge/src/ingest.ts). */
export interface IngestResponse {
  listingId: string
  existing: boolean
  needsDetails: boolean
  missingFields: string[]
  confidence: number
  possibleDuplicates: { id: string; title: string | null }[]
}

/** The extension sends what it parsed on the live page; the function dedups and saves it. */
export function ingestBody(huntId: string, result: ParseResult) {
  return { huntId, parsed: result.listing }
}

/** <webAppUrl>#/h/<huntId>/l/<listingId>, the web app's listing detail route. */
export function listingLink(webAppUrl: string, huntId: string, listingId: string): string {
  let base = webAppUrl.trim().replace(/#.*$/, '')
  if (!base.endsWith('/')) base += '/'
  return `${base}#/h/${huntId}/l/${listingId}`
}

export interface Preview {
  title: string
  total: string
  area: string
  rooms: string
  /** 0–100 */
  confidence: number
  missing: string[]
}

const FIELD_NAMES: Record<string, string> = {
  title: 'title',
  rent: 'price',
  areaM2: 'm²',
  rooms: 'rooms',
  district: 'location',
  photos: 'photos',
}

export function preview(result: ParseResult): Preview {
  const l = result.listing
  return {
    title: l.title ?? l.url,
    total: formatPLN(totalMonthly(l)),
    area: formatArea(l.areaM2),
    rooms: l.rooms == null ? '—' : String(l.rooms),
    confidence: Math.round(result.confidence * 100),
    missing: result.missingFields.map((f) => FIELD_NAMES[f] ?? f),
  }
}

// Extension stores refuse injected scripts.
const STORES =
  /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com|addons\.mozilla\.org)/i

/** Pages the extension can read: http(s), except the extension stores. */
export function isReadableUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url) && !STORES.test(url)
}
