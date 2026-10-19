import type { ParsedListing } from '@at/shared'
import type { SiteAdapter } from '../types.ts'
import { buildResult } from '../result.ts'
import { htmlToText, jsonLd, meta, metaAll, title } from '../html.ts'
import { toInt, toNumber } from '../numbers.ts'

type Obj = Record<string, any>

const LISTING_TYPES =
  /Product|Offer|Apartment|Residence|House|Accommodation|RealEstateListing|SingleFamilyResidence|Place/i

function typeOf(node: Obj): string {
  return [node['@type']].flat().join(' ')
}

function imageUrls(v: unknown): string[] {
  return [v]
    .flat()
    .map((i) => (typeof i === 'string' ? i : ((i as Obj)?.url ?? (i as Obj)?.contentUrl)))
    .filter((i): i is string => typeof i === 'string')
}

/** JSON-LD → OpenGraph → <title>/meta. Works on any site, finds little on most. */
export const genericAdapter: SiteAdapter = {
  name: 'generic',
  matches: () => true,
  parse(html, url) {
    const nodes = jsonLd(html)
    const node: Obj = nodes.find((n) => LISTING_TYPES.test(typeOf(n))) ?? {}
    const about: Obj = node.itemOffered ?? node.about ?? node.mainEntity ?? {}
    const pick = (key: string) => node[key] ?? about[key]
    const offers: Obj =
      [node.offers ?? about.offers].flat()[0] ?? (typeOf(node).includes('Offer') ? node : {})
    const addr: Obj = pick('address') ?? {}
    const geo: Obj = pick('geo') ?? {}
    const description =
      pick('description') ?? meta(html, 'og:description') ?? meta(html, 'description')

    const draft: Partial<Record<keyof ParsedListing, unknown>> = {
      title: pick('name') ?? meta(html, 'og:title') ?? title(html),
      description: description ? htmlToText(String(description)) : undefined,
      rent: toNumber(
        offers.price ?? meta(html, 'product:price:amount') ?? meta(html, 'og:price:amount'),
      ),
      areaM2: toNumber(pick('floorSize')?.value ?? pick('floorSize')),
      rooms: toInt(pick('numberOfRooms') ?? pick('numberOfBedrooms')),
      address:
        typeof addr === 'string'
          ? addr
          : [addr.streetAddress, addr.addressRegion, addr.addressLocality]
              .filter(Boolean)
              .join(', '),
      district: typeof addr === 'object' ? addr.addressRegion : undefined,
      lat: toNumber(geo.latitude ?? meta(html, 'place:location:latitude')),
      lng: toNumber(geo.longitude ?? meta(html, 'place:location:longitude')),
      photos: [...imageUrls(pick('image') ?? pick('photo')), ...metaAll(html, 'og:image')].filter(
        (u) => /^https?:\/\//.test(u),
      ),
    }
    return buildResult(url, draft as never, Object.keys(node).length ? node : undefined)
  },
}
