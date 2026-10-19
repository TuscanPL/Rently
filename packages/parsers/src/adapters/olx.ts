import type { ParsedListing } from '@at/shared'
import type { SiteAdapter } from '../types.ts'
import { buildResult } from '../result.ts'
import { htmlToText, jsonLd, safeJsonParse } from '../html.ts'
import { toFloor, toInt, toNumber, toRooms } from '../numbers.ts'
import { apolloSized, MEDIUM, THUMB } from '../photos.ts'

type Obj = Record<string, any>

/** OLX stores its Redux state as a JSON-encoded string in window.__PRERENDERED_STATE__. */
function prerenderedState(html: string): Obj | undefined {
  const m = html.match(/__PRERENDERED_STATE__\s*=\s*("(?:[^"\\]|\\.)*")/)
  if (!m) return undefined
  const inner = safeJsonParse(m[1])
  return typeof inner === 'string' ? (safeJsonParse(inner) as Obj) : undefined
}

const YES = /^(yes|tak|true|1)$/i

export const olxAdapter: SiteAdapter = {
  name: 'olx',
  matches: (url) => /(^|\.)olx\.pl$/i.test(url.hostname),
  parse(html, url) {
    const ad: Obj = prerenderedState(html)?.ad?.ad ?? {}
    const params: Obj[] = Array.isArray(ad.params) ? ad.params : []
    const param = (key: string) => {
      const p = params.find((x) => x?.key === key)
      return p?.normalizedValue ?? p?.value
    }
    const flag = (key: string) => {
      const v = param(key)
      return v == null ? undefined : YES.test(String(v))
    }
    const product = jsonLd(html).find((n) => n['@type'] === 'Product') as Obj | undefined
    const photos: string[] = (Array.isArray(ad.photos) ? ad.photos : [])
      .map((p: unknown) => (typeof p === 'string' ? p : (p as Obj)?.link))
      .filter(Boolean)
    const ldImages: string[] = [product?.image].flat().filter((i) => typeof i === 'string')
    const allPhotos = photos.length ? photos : ldImages

    const draft: Partial<Record<keyof ParsedListing, unknown>> = {
      source: 'olx',
      title: ad.title ?? product?.name,
      description: htmlToText(String(ad.description ?? product?.description ?? '')),
      rent: toNumber(ad.price?.regularPrice?.value ?? product?.offers?.price),
      adminFee: toNumber(param('rent')),
      areaM2: toNumber(param('m')),
      rooms: toRooms(param('rooms')),
      floor: toFloor(param('floor_select') ?? param('floor')),
      address: [ad.location?.districtName, ad.location?.cityName].filter(Boolean).join(', '),
      district: ad.location?.districtName,
      lat: toNumber(ad.map?.lat),
      lng: toNumber(ad.map?.lon),
      advertiserType: ad.isBusiness == null ? undefined : ad.isBusiness ? 'agency' : 'private',
      features: {
        furnished: flag('furniture'),
        petsAllowed: flag('pets'),
        elevator: flag('elevator') ?? flag('winda'),
        parking: flag('parking'),
        balcony: flag('balcony'),
        yearBuilt: toInt(param('year_built')),
      },
      photos: allPhotos.map((p) => apolloSized(p, MEDIUM)),
      coverThumbnailUrl: allPhotos[0] ? apolloSized(allPhotos[0], THUMB) : undefined,
    }
    return buildResult(url, draft as never, { params, location: ad.location, map: ad.map })
  },
}
