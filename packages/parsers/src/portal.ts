import type { ParsedListing } from '@at/shared'
import { dataAttr, htmlToText, itemprops, textLines, type ImageCandidate } from './html.ts'
import { toFloor, toInt, toIsoDate, toNumber, toRooms } from './numbers.ts'
import { imageUrls, jsonLdListing } from './adapters/generic.ts'
import { buildResult } from './result.ts'
import type { ParseResult } from './types.ts'

// Shared by the Gratka, Morizon, Nieruchomosci-online and Domiporta adapters.
// Those sites have no big embedded state blob; they have some structured data
// (JSON-LD or microdata) and a label/value list of details ("Powierzchnia" /
// "52 m²"). portalDraft() reads structured data first, then the labels, then
// whatever site-specific bits the adapter found in the markup.

type Draft = Partial<Record<keyof ParsedListing, unknown>>
type Obj = Record<string, any>

/**
 * Value for the first line that is exactly the label (value on the next line)
 * or "label: value". The label must be the whole line or end in a colon, so
 * "Cena" doesn't match "Cena za m²: 67 zł".
 */
export function labelled(lines: string[], label: string): string | undefined {
  const own = new RegExp(`^(?:${label})\\s*:?$`, 'i')
  const inline = new RegExp(`^(?:${label})\\s*:\\s*(.+)$`, 'i')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const m = line.match(inline)
    if (m) return m[1]
    const next = lines[i + 1]
    if (own.test(line) && next && !next.endsWith(':')) return next
  }
  return undefined
}

export function yesNo(v: string | undefined): boolean | undefined {
  if (!v) return undefined
  if (/^(nie|brak|no|false)\b/i.test(v)) return false
  if (/^(tak|jest|yes|true|dostępn|możliw)/i.test(v)) return true
  return undefined
}

export function advertiserFrom(v: string | undefined): ParsedListing['advertiserType'] {
  if (!v) return undefined
  if (/prywatn|bezpośredni|właściciel/i.test(v)) return 'private'
  if (/biuro|agencj|pośrednik|deweloper|firma/i.test(v)) return 'agency'
  return undefined
}

/** "3/5", "3 z 5", "parter / 4", "3 (z 5)" → floor and total floors. */
export function floorAndTotal(v: string | undefined): Pick<ParsedListing, 'floor' | 'totalFloors'> {
  if (!v) return {}
  const [first, total] = v.split(/\s*(?:\/|\(?\s*z\s+)\s*/i)
  return { floor: toFloor(first?.trim()), totalFloors: toInt(total) }
}

const STREET = /^(ul\.|al\.|aleja|pl\.|plac|os\.|osiedle|ulica)\s/i
const VOIVODESHIP = /(skie|ckie|zkie)$/i

/**
 * District from a location like "Warszawa, Mokotów, Stegny, ul. Bokserska" (city
 * first) or "ul. Bokserska, Mokotów, Warszawa" (city last): the part next to the
 * city, skipping streets, voivodeships and the country.
 */
export function districtFrom(location: string | undefined, city?: string): string | undefined {
  if (!location) return undefined
  const parts = location
    .split(/\s*,\s*/)
    .map((p) => p.trim())
    .filter((p) => p && !STREET.test(p) && !VOIVODESHIP.test(p) && !/^polska$/i.test(p))
  if (parts.length < 2) return undefined
  let i = city ? parts.findIndex((p) => p.toLowerCase() === city.toLowerCase()) : -1
  if (i === -1) i = 0
  return i === parts.length - 1 ? parts[i - 1] : parts[i + 1]
}

/** Everything the common Polish detail labels give. */
export function fieldsFromLabels(lines: string[]): Draft & { location?: string } {
  const get = (label: string) => labelled(lines, label)
  const floor = floorAndTotal(get('Piętro'))
  return {
    rent: toNumber(get('Cena|Cena najmu|Cena wynajmu|Czynsz najmu|Najem')),
    adminFee: toNumber(
      get(
        'Czynsz|Czynsz administracyjny|Czynsz dodatkowo|Opłaty|Opłaty administracyjne|Opłaty \\([^)]*\\)',
      ),
    ),
    utilitiesEstimate: toNumber(get('Media|Opłaty za media|Media \\(szacunkowo\\)')),
    deposit: toNumber(get('Kaucja|Kaucja zwrotna|Depozyt')),
    areaM2: toNumber(
      get(
        'Powierzchnia|Powierzchnia użytkowa|Pow\\. użytkowa|Pow\\. całkowita|Powierzchnia w m2|Powierzchnia całkowita|Metraż',
      ),
    ),
    rooms: toRooms(get('Liczba pokoi|Pokoje|Ilość pokoi')),
    floor: floor.floor,
    totalFloors:
      floor.totalFloors ??
      toInt(get('Liczba pięter|Liczba pięter w budynku|Ilość pięter|Pięter w budynku')),
    availableFrom: toIsoDate(get('Dostępne od|Dostępny od|Wolne od|Data dostępności|Dostępne')),
    advertiserType: advertiserFrom(
      get('Typ ogłoszeniodawcy|Ogłoszeniodawca|Oferta od|Oferent|Rodzaj ogłoszeniodawcy'),
    ),
    district: get('Dzielnica'),
    location: get('Lokalizacja|Adres|Położenie'),
    features: {
      yearBuilt: toInt(get('Rok budowy')),
      heating: get('Ogrzewanie|Rodzaj ogrzewania|Typ ogrzewania'),
      furnished: yesNo(get('Umeblowane|Umeblowanie|Meble|Umeblowany')),
      elevator: yesNo(get('Winda')),
      balcony: yesNo(get('Balkon')),
      parking: yesNo(get('Miejsce parkingowe|Parking|Garaż')),
      petsAllowed: yesNo(get('Zwierzęta|Zwierzęta domowe|Przyjazne zwierzętom')),
    },
  }
}

const inPoland = (lat?: number, lng?: number) =>
  lat != null && lng != null && lat > 48 && lat < 56 && lng > 13 && lng < 25

/** Map coordinates from data-lat/data-lng attributes or "lat"/"lng" keys in embedded JSON. */
export function coordinatesIn(html: string): { lat?: number; lng?: number } {
  let lat = toNumber(dataAttr(html, 'lat') ?? dataAttr(html, 'latitude'))
  let lng = toNumber(dataAttr(html, 'lng') ?? dataAttr(html, 'lon') ?? dataAttr(html, 'longitude'))
  if (!inPoland(lat, lng)) {
    lat = toNumber(html.match(/"lat(?:itude)?"\s*:\s*"?(\d{2}\.\d+)/)?.[1])
    lng = toNumber(html.match(/"(?:lng|lon|longitude)"\s*:\s*"?(\d{2}\.\d+)/)?.[1])
  }
  return inPoland(lat, lng) ? { lat, lng } : {}
}

/**
 * Gallery images when the gallery was found, else the JSON-LD or microdata
 * images. Never both: they'd list the same photos in different sizes.
 */
export function galleryOr(gallery: ImageCandidate[], html: string): (string | ImageCandidate)[] {
  if (gallery.length) return gallery
  const ld = imageUrls(jsonLdListing(html).pick('image'))
  return ld.length ? ld : (itemprops(html).get('image') ?? [])
}

const MEDIUM_WIDTH = 1280
const THUMB_WIDTH = 300

/** Widest srcset entry up to MEDIUM_WIDTH, else the plain src. */
function srcsetMedium(img: ImageCandidate): string {
  return img.srcset.filter((e) => e.w <= MEDIUM_WIDTH).pop()?.url ?? img.src
}

/** Smallest srcset entry at least THUMB_WIDTH wide; undefined when there is no srcset. */
function srcsetThumb(img: ImageCandidate): string | undefined {
  return (img.srcset.find((e) => e.w >= THUMB_WIDTH) ?? img.srcset[img.srcset.length - 1])?.url
}

/**
 * The ad's own photos from candidate images (JSON-LD, gallery markup): only the
 * site's CDN, only this ad's when `belongs` can tell (ignored if it would drop
 * everything), a medium variant for the gallery and a small one for the cover.
 * Without size rules for the CDN, the variants come from srcset.
 */
export function sitePhotos(
  images: (string | ImageCandidate)[],
  opts: {
    cdn: RegExp
    medium?: (url: string) => string
    thumb?: (url: string) => string
    belongs?: (url: string) => boolean
  },
): Pick<PortalHints, 'photos' | 'coverThumbnailUrl'> {
  let own = images
    .map((i) => (typeof i === 'string' ? { src: i, srcset: [] } : i))
    .filter((i) => {
      try {
        return opts.cdn.test(new URL(i.src).hostname)
      } catch {
        return false
      }
    })
  const belongs = opts.belongs
  if (belongs && own.some((i) => belongs(i.src))) own = own.filter((i) => belongs(i.src))
  const medium = (i: ImageCandidate) => (opts.medium ? opts.medium(i.src) : srcsetMedium(i))
  const thumb = (i: ImageCandidate) => (opts.thumb ? opts.thumb(i.src) : srcsetThumb(i))
  return {
    photos: [...new Set(own.map(medium))],
    coverThumbnailUrl: own[0] ? thumb(own[0]) : undefined,
  }
}

/** What the adapter found in the site's own markup. */
export interface PortalHints {
  /** HTML holding the label/value details; the whole page when the container wasn't found. */
  details?: string
  title?: string
  /** Price text as shown, e.g. "3 900 zł". */
  price?: string
  /** "Warszawa, Mokotów, Stegny, ul. Bokserska" or similar. */
  location?: string
  descriptionHtml?: string
  photos?: string[]
  coverThumbnailUrl?: string
}

/**
 * Builds the adapter's result: structured data (JSON-LD, microdata) first, then
 * the detail labels, then the hints. raw keeps the JSON-LD node and the detail lines.
 */
export function portalResult(
  url: URL,
  html: string,
  source: ParsedListing['source'],
  hints: PortalHints,
): ParseResult {
  const lines = textLines(hints.details ?? html)
  const draft = { ...portalDraft(html, lines, hints), source }
  const ld = jsonLdListing(html).node
  return buildResult(url, draft as never, {
    jsonLd: Object.keys(ld).length ? ld : undefined,
    details: hints.details ? lines.slice(0, 200) : undefined,
  })
}

function portalDraft(html: string, lines: string[], hints: PortalHints): Draft {
  const ld = jsonLdListing(html)
  const md = itemprops(html)
  const mdFirst = (key: string) => md.get(key)?.[0]
  const labels = fieldsFromLabels(lines)
  const ldAddr: Obj = typeof ld.pick('address') === 'object' ? ld.pick('address') : {}
  const city = ldAddr.addressLocality ?? mdFirst('addressLocality')
  const location =
    hints.location ??
    labels.location ??
    ([ldAddr.streetAddress, ldAddr.addressRegion, ldAddr.addressLocality]
      .filter(Boolean)
      .join(', ') ||
      undefined)
  const geo = coordinatesIn(html)
  const description = hints.descriptionHtml ?? ld.pick('description') ?? mdFirst('description')

  return {
    // Microdata "name" last: breadcrumbs use it too.
    title: ld.pick('name') ?? hints.title ?? mdFirst('name'),
    description: description ? htmlToText(String(description)) : undefined,
    rent: toNumber(ld.offers.price ?? mdFirst('price')) ?? labels.rent ?? toNumber(hints.price),
    adminFee: labels.adminFee,
    utilitiesEstimate: labels.utilitiesEstimate,
    deposit: labels.deposit,
    areaM2:
      toNumber(ld.pick('floorSize')?.value ?? ld.pick('floorSize') ?? mdFirst('floorSize')) ??
      labels.areaM2,
    rooms: toRooms(ld.pick('numberOfRooms') ?? mdFirst('numberOfRooms')) ?? labels.rooms,
    floor: labels.floor,
    totalFloors: labels.totalFloors,
    address: location,
    district: labels.district ?? districtFrom(location, city),
    lat: toNumber(ld.pick('geo')?.latitude ?? mdFirst('latitude')) ?? geo.lat,
    lng: toNumber(ld.pick('geo')?.longitude ?? mdFirst('longitude')) ?? geo.lng,
    availableFrom: labels.availableFrom,
    advertiserType: labels.advertiserType,
    features: labels.features,
    photos: hints.photos,
    coverThumbnailUrl: hints.coverThumbnailUrl,
  }
}
