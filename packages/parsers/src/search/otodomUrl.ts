// Builds an Otodom search results link from simple filters, for searches set up
// in the app. Otodom's own link format: the place is in the path
// (/pl/wyniki/wynajem/mieszkanie/<voivodeship>/<city>/<city>/<city>[/<district>]),
// the filters are query parameters, and lists are written as [A,B].

export interface OtodomSearchParams {
  /** A key of OTODOM_CITIES. */
  city: string
  /** A key of the city's districts, or null for the whole city. */
  district: string | null
  /** Rent without czynsz, PLN. */
  priceMax: number | null
  roomsMin: number | null
  roomsMax: number | null
  areaMin: number | null
  privateOnly: boolean
}

interface City {
  label: string
  path: string
  districts: Record<string, string>
}

export const OTODOM_CITIES: Record<string, City> = {
  warszawa: {
    label: 'Warszawa',
    path: 'mazowieckie/warszawa/warszawa/warszawa',
    districts: {
      bemowo: 'Bemowo',
      bialoleka: 'Białołęka',
      bielany: 'Bielany',
      mokotow: 'Mokotów',
      ochota: 'Ochota',
      'praga-polnoc': 'Praga-Północ',
      'praga-poludnie': 'Praga-Południe',
      rembertow: 'Rembertów',
      srodmiescie: 'Śródmieście',
      targowek: 'Targówek',
      ursus: 'Ursus',
      ursynow: 'Ursynów',
      wawer: 'Wawer',
      wesola: 'Wesoła',
      wilanow: 'Wilanów',
      wlochy: 'Włochy',
      wola: 'Wola',
      zoliborz: 'Żoliborz',
    },
  },
  krakow: { label: 'Kraków', path: 'malopolskie/krakow/krakow/krakow', districts: {} },
  wroclaw: { label: 'Wrocław', path: 'dolnoslaskie/wroclaw/wroclaw/wroclaw', districts: {} },
  gdansk: { label: 'Gdańsk', path: 'pomorskie/gdansk/gdansk/gdansk', districts: {} },
  poznan: { label: 'Poznań', path: 'wielkopolskie/poznan/poznan/poznan', districts: {} },
  lodz: { label: 'Łódź', path: 'lodzkie/lodz/lodz/lodz', districts: {} },
}

const ROOM_WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN']

/** The city key for a hunt's city name, e.g. "Warszawa" → "warszawa". */
export function otodomCityFor(name: string | null | undefined): string | null {
  const key = (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .trim()
  return key in OTODOM_CITIES ? key : null
}

export function buildOtodomSearchUrl(p: OtodomSearchParams): string {
  const city = OTODOM_CITIES[p.city]
  if (!city) throw new Error(`Unknown city: ${p.city}`)
  const district = p.district && city.districts[p.district] ? `/${p.district}` : ''
  const url = new URL(`https://www.otodom.pl/pl/wyniki/wynajem/mieszkanie/${city.path}${district}`)
  const q = url.searchParams
  if (p.priceMax) q.set('priceMax', String(Math.round(p.priceMax)))
  if (p.areaMin) q.set('areaMin', String(Math.round(p.areaMin)))
  if (p.roomsMin || p.roomsMax) {
    const from = Math.max(1, p.roomsMin ?? 1)
    // "TEN" covers 10 and more on Otodom.
    const to = Math.min(10, p.roomsMax ?? 10)
    const rooms = ROOM_WORDS.slice(from - 1, Math.max(from, to))
    if (rooms.length && rooms.length < ROOM_WORDS.length)
      q.set('roomsNumber', `[${rooms.join(',')}]`)
  }
  q.set('ownerTypeSingleSelect', p.privateOnly ? 'PRIVATE' : 'ALL')
  // Newest first, so a refresh of page 1 shows what's just been listed.
  q.set('by', 'LATEST')
  q.set('direction', 'DESC')
  q.set('viewType', 'listing')
  return url.toString()
}

/** Adds newest-first sorting to a pasted link that doesn't choose an order. */
export function withNewestFirst(input: string): string {
  const url = new URL(input)
  if (!url.searchParams.has('by')) {
    url.searchParams.set('by', 'LATEST')
    url.searchParams.set('direction', 'DESC')
  }
  return url.toString()
}
