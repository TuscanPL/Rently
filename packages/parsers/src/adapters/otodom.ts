import type { ParsedListing } from '@at/shared'
import type { SiteAdapter } from '../types.ts'
import { buildResult } from '../result.ts'
import { htmlToText, safeJsonParse, scriptById } from '../html.ts'
import { toFloor, toInt, toIsoDate, toNumber, toRooms } from '../numbers.ts'
import { apolloSized, MEDIUM, THUMB } from '../photos.ts'

type Obj = Record<string, any>

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v)

/** Otodom ad pages embed the full ad as Next.js page props in <script id="__NEXT_DATA__">. */
export const otodomAdapter: SiteAdapter = {
  name: 'otodom',
  matches: (url) => /(^|\.)otodom\.pl$/i.test(url.hostname),
  parse(html, url) {
    const next = safeJsonParse(scriptById(html, '__NEXT_DATA__')) as Obj | undefined
    const ad: Obj = next?.props?.pageProps?.ad ?? {}
    const target: Obj = ad.target ?? {}
    const characteristics: Obj[] = Array.isArray(ad.characteristics) ? ad.characteristics : []
    const char = (key: string) => characteristics.find((c) => c?.key === key)?.value

    const extras: string[] = [
      ...(target.Extras_types ?? []),
      ...(target.Equipment_types ?? []),
      ...(target.Security_types ?? []),
    ].map(String)
    const address: Obj = ad.location?.address ?? {}
    const geoDistrict = (ad.location?.reverseGeocoding?.locations as Obj[] | undefined)?.find(
      (l) => l?.locationLevel === 'district',
    )?.name
    const street = [address.street?.name, address.street?.number].filter(Boolean).join(' ')
    const images: Obj[] = Array.isArray(ad.images) ? ad.images : []
    const advertiser = String(ad.advertiserType ?? target.user_type ?? '').toLowerCase()
    const pets = String(first(target.Pets) ?? char('pets') ?? '').toLowerCase()

    const draft: Partial<Record<keyof ParsedListing, unknown>> = {
      source: 'otodom',
      title: ad.title,
      description: typeof ad.description === 'string' ? htmlToText(ad.description) : undefined,
      rent: toNumber(target.Price ?? char('price')),
      adminFee: toNumber(target.Rent ?? char('rent')),
      deposit: toNumber(target.Deposit ?? char('deposit')),
      areaM2: toNumber(target.Area ?? char('m')),
      rooms: toRooms(first(target.Rooms_num) ?? char('rooms_num')),
      floor: toFloor(first(target.Floor_no) ?? char('floor_no')),
      totalFloors: toInt(target.Building_floors_num ?? char('building_floors_num')),
      address: [street, address.district?.name, address.city?.name].filter(Boolean).join(', '),
      district: address.district?.name ?? geoDistrict,
      lat: toNumber(ad.location?.coordinates?.latitude),
      lng: toNumber(ad.location?.coordinates?.longitude),
      availableFrom: toIsoDate(target.Free_from ?? char('free_from')),
      advertiserType: advertiser ? (advertiser === 'private' ? 'private' : 'agency') : undefined,
      features: {
        elevator: extras.includes('lift') || undefined,
        balcony: extras.some((e) => /balcony|terrace|loggia/.test(e)) || undefined,
        parking: extras.some((e) => /garage|parking/.test(e)) || undefined,
        furnished: extras.includes('furniture') || undefined,
        yearBuilt: toInt(target.Build_year ?? char('build_year')),
        heating: first(target.Heating) ?? char('heating'),
        petsAllowed: pets ? /^(y|yes|tak|true|1)$/.test(pets) : undefined,
      },
      photos: images
        .map((i) => i.medium ?? i.large ?? (i.small && apolloSized(i.small, MEDIUM)))
        .filter(Boolean),
      coverThumbnailUrl: images[0]
        ? (images[0].small ?? images[0].thumbnail ?? apolloSized(images[0].medium, THUMB))
        : undefined,
    }
    return buildResult(url, draft as never, { target, characteristics, location: ad.location })
  },
}
