import { firstUrl } from '@at/parsers'

// The manifest's share_target (vite.config.ts) opens "<base>?title=…&text=…&url=…#/add":
// the browser puts the shared values in the real query string, outside the hash
// route. Before the router starts, move them into the route's own query
// ("#/add?url=…"). That cleans the address bar, and the values travel with the
// route through the login redirect (POST_LOGIN_KEY stores the route's fullPath).

export const SHARE_PARAMS = ['url', 'text', 'title'] as const

type Loc = Pick<Location, 'pathname' | 'search' | 'hash'>
type Hist = Pick<History, 'replaceState' | 'state'>

export function adoptShareParams(loc: Loc = window.location, hist: Hist = window.history): void {
  const search = new URLSearchParams(loc.search)
  if (!SHARE_PARAMS.some((k) => search.get(k))) return
  const [path = '', routeQuery = ''] = loc.hash.replace(/^#/, '').split('?', 2)
  if (path !== '/add') return

  const query = new URLSearchParams(routeQuery)
  for (const key of SHARE_PARAMS) {
    const value = search.get(key)
    if (value && !query.has(key)) query.set(key, value)
    search.delete(key)
  }
  const rest = search.toString()
  hist.replaceState(hist.state, '', `${loc.pathname}${rest ? `?${rest}` : ''}#/add?${query}`)
}

export interface SharedListing {
  /** The listing link: `url`, else the first link in `text` (many apps share that way), else in `title`. */
  url: string | null
  /** Title and text together, for the paste-text flow when there's no link. */
  text: string
}

export function readShared(params: Partial<Record<(typeof SHARE_PARAMS)[number], string>>) {
  const url =
    params.url?.trim() || firstUrl(params.text ?? '') || firstUrl(params.title ?? '') || null
  const text = [params.title, params.text]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join('\n')
  return { url, text } satisfies SharedListing
}
