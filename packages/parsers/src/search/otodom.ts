import { safeJsonParse, scriptById } from '../html.ts'
import { toFloor, toNumber, toRooms } from '../numbers.ts'

// Otodom search results ("/pl/wyniki/…"): the page embeds the whole result
// list in __NEXT_DATA__, so a search can be read without opening every ad.
// Read leniently: any field may be missing, and an item without an id or slug
// is skipped rather than failing the page.

export interface SearchItem {
  /** Otodom's ad id, stable across refreshes. */
  externalId: string
  url: string
  title: string | null
  rent: number | null
  adminFee: number | null
  areaM2: number | null
  rooms: number | null
  floor: number | null
  district: string | null
  address: string | null
  privateOwner: boolean | null
  photos: string[]
  postedAt: string | null
}

export interface SearchPage {
  items: SearchItem[]
  page: number
  totalPages: number
  totalResults: number | null
}

type Obj = Record<string, any>

const ROOM_WORDS: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  SEVEN: 7,
  EIGHT: 8,
  NINE: 9,
  TEN: 10,
}

const FLOOR_WORDS: Record<string, number> = {
  CELLAR: -1,
  GROUND: 0,
  FIRST: 1,
  SECOND: 2,
  THIRD: 3,
  FOURTH: 4,
  FIFTH: 5,
  SIXTH: 6,
  SEVENTH: 7,
  EIGHTH: 8,
  NINTH: 9,
  TENTH: 10,
  ABOVE_TENTH: 11,
}

/** True for an Otodom search results URL (as opposed to a single ad). */
export function isOtodomSearchUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return /(^|\.)otodom\.pl$/i.test(url.hostname) && /^\/(pl|en)\/wyniki\//.test(url.pathname)
  } catch {
    return false
  }
}

/** The same search on another result page. */
export function otodomSearchPageUrl(input: string, page: number): string {
  const url = new URL(input)
  if (page <= 1) url.searchParams.delete('page')
  else url.searchParams.set('page', String(page))
  return url.toString()
}

function money(v: unknown): number | null {
  const n = toNumber(v && typeof v === 'object' ? (v as Obj).value : v)
  return n != null && n > 0 ? n : null
}

function district(location: Obj | undefined): string | null {
  const locations: Obj[] = location?.reverseGeocoding?.locations ?? []
  const d = locations.find((l) => l?.locationLevel === 'district') ?? null
  if (d)
    return (
      String(d.name ?? d.fullName ?? '')
        .split(',')[0]!
        .trim() || null
    )
  return location?.address?.district?.name ?? null
}

function item(raw: Obj, origin: string): SearchItem | null {
  const id = raw?.id
  const slug = raw?.slug
  if (id == null || typeof slug !== 'string' || !slug) return null
  const address: Obj = raw.location?.address ?? {}
  const street = [address.street?.name, address.street?.number].filter(Boolean).join(' ')
  const images: Obj[] = Array.isArray(raw.images) ? raw.images : []
  const rooms = raw.roomsNumber
  const floor = raw.floorNumber
  return {
    externalId: String(id),
    url: `${origin}/pl/oferta/${slug}`,
    title: typeof raw.title === 'string' ? raw.title.trim() : null,
    rent: money(raw.totalPrice ?? raw.price),
    adminFee: money(raw.rentPrice),
    areaM2: toNumber(raw.areaInSquareMeters) ?? null,
    rooms: (typeof rooms === 'string' ? ROOM_WORDS[rooms] : undefined) ?? toRooms(rooms) ?? null,
    floor: (typeof floor === 'string' ? FLOOR_WORDS[floor] : undefined) ?? toFloor(floor) ?? null,
    district: district(raw.location),
    address: [street, address.city?.name].filter(Boolean).join(', ') || null,
    privateOwner:
      typeof raw.isPrivateOwner === 'boolean' ? raw.isPrivateOwner : raw.agency ? false : null,
    photos: images
      .map((img) => img?.large ?? img?.medium ?? img?.small)
      .filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)),
    postedAt: raw.dateCreatedFirst ?? raw.dateCreated ?? null,
  }
}

/** Parses one Otodom results page. Never throws: an unreadable page gives no items. */
export function parseOtodomSearch(html: string, pageUrl: string): SearchPage {
  const origin = new URL(pageUrl).origin
  const next = safeJsonParse(scriptById(html, '__NEXT_DATA__')) as Obj | undefined
  const searchAds: Obj =
    next?.props?.pageProps?.data?.searchAds ?? next?.props?.pageProps?.searchAds ?? {}
  const rawItems: Obj[] = Array.isArray(searchAds.items) ? searchAds.items : []
  const seen = new Set<string>()
  const items = rawItems
    .map((raw) => {
      try {
        return item(raw, origin)
      } catch {
        return null
      }
    })
    .filter(
      (i): i is SearchItem => i != null && !seen.has(i.externalId) && !!seen.add(i.externalId),
    )
  const pagination: Obj = searchAds.pagination ?? {}
  const page = toNumber(pagination.page) ?? Number(new URL(pageUrl).searchParams.get('page') ?? 1)
  const totalPages = toNumber(pagination.totalPages) ?? page
  return {
    items,
    page,
    totalPages,
    totalResults: toNumber(pagination.totalResults ?? pagination.totalItems) ?? null,
  }
}
