import type { ListingSource } from '@at/shared'

const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^gbraid$/i,
  /^wbraid$/i,
  /^msclkid$/i,
  /^mc_[ce]id$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^_ga$/i,
  /^igshid$/i,
  /^si$/i,
  /^reason$/i,
  /^search_reason$/i,
  /^bs$/i,
  /^isPreviewActive$/i,
  /^sd$/i,
  /^__tn__$/i,
  /^mibextid$/i,
  /^rdid$/i,
  /^share_url$/i,
]

/** Sites where the query string never identifies the listing. */
const DROP_ALL_QUERY =
  /(^|\.)(otodom\.pl|olx\.pl|gratka\.pl|morizon\.pl|nieruchomosci-online\.pl|domiporta\.pl)$/i

export function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^(www|m)\./, '')
}

/**
 * Canonical form used for dedup: https, no "www."/"m.", no fragment, no tracking
 * params (all params on known listing sites), no trailing slash.
 */
export function canonicalizeUrl(input: string): string {
  const url = new URL(input.trim())
  url.protocol = 'https:'
  url.hostname = hostOf(url)
  url.hash = ''
  url.port = ''
  if (DROP_ALL_QUERY.test(url.hostname)) {
    url.search = ''
  } else {
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.some((re) => re.test(key))) url.searchParams.delete(key)
    }
    url.searchParams.sort()
  }
  // Otodom serves the same ad under /pl/oferta/ and /oferta/.
  if (url.hostname === 'otodom.pl')
    url.pathname = url.pathname.replace(/^\/(pl|en)\/oferta\//, '/oferta/')
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString()
}

export function sourceForUrl(input: string | URL): ListingSource {
  let host: string
  try {
    host = hostOf(typeof input === 'string' ? new URL(input) : input)
  } catch {
    return 'other'
  }
  const is = (domain: string) => host === domain || host.endsWith(`.${domain}`)
  if (is('otodom.pl')) return 'otodom'
  if (is('olx.pl')) return 'olx'
  if (is('gratka.pl')) return 'gratka'
  if (is('morizon.pl')) return 'morizon'
  if (is('nieruchomosci-online.pl')) return 'nieruchomosci_online'
  if (is('domiporta.pl')) return 'domiporta'
  if (is('facebook.com') || is('fb.com') || is('fb.watch')) return 'facebook'
  return 'other'
}

/** First http(s) URL in a blob of text (share sheets often put the link in `text`). */
export function firstUrl(text: string | null | undefined): string | undefined {
  const m = text?.match(/https?:\/\/[^\s<>"']+/i)
  return m?.[0].replace(/[).,;!?]+$/, '')
}

/** "mieszkanie-3-pokoje-mokotow-ID4abc" → "Mieszkanie 3 pokoje mokotow": a title of last resort. */
export function titleFromUrl(input: string): string | undefined {
  try {
    const last = new URL(input).pathname.split('/').filter(Boolean).pop()
    if (!last) return undefined
    const words = decodeURIComponent(last)
      .replace(/\.html?$/i, '')
      .replace(/-(ID|CID)\w+/g, '')
      .split(/[-_]+/)
      .filter(Boolean)
    if (words.length < 2) return undefined
    const s = words.join(' ')
    return s.charAt(0).toUpperCase() + s.slice(1)
  } catch {
    return undefined
  }
}
