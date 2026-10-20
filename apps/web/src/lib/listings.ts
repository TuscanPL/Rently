import type { AdvertiserType, ListingFeatures, ListingSource, ParsedListing } from '@at/shared'
import { totalMonthly } from '@at/shared'
import { supabase, type Tables } from './supabase'

export type Listing = Tables<'listings'>
export type ListingPhoto = Tables<'listing_photos'>
export type ListingWithPhotos = Listing & { listing_photos: ListingPhoto[] }

export interface IngestResponse {
  listingId: string
  existing: boolean
  needsDetails: boolean
  missingFields: string[]
  confidence: number
  fetched: boolean
  possibleDuplicates: { id: string; title: string | null }[]
}

/** The editable fields of a listing, camelCased for forms. */
export interface ListingDraft {
  title: string
  url: string
  rent: number | null
  adminFee: number | null
  utilitiesEstimate: number | null
  deposit: number | null
  areaM2: number | null
  rooms: number | null
  floor: number | null
  totalFloors: number | null
  district: string
  address: string
  availableFrom: string
  advertiserType: AdvertiserType
  description: string
  features: ListingFeatures
}

export function emptyDraft(): ListingDraft {
  return {
    title: '',
    url: '',
    rent: null,
    adminFee: null,
    utilitiesEstimate: null,
    deposit: null,
    areaM2: null,
    rooms: null,
    floor: null,
    totalFloors: null,
    district: '',
    address: '',
    availableFrom: '',
    advertiserType: 'unknown',
    description: '',
    features: {},
  }
}

export function draftFromListing(l: Listing): ListingDraft {
  return {
    title: l.title ?? '',
    url: l.url ?? '',
    rent: l.rent,
    adminFee: l.admin_fee,
    utilitiesEstimate: l.utilities_estimate,
    deposit: l.deposit,
    areaM2: l.area_m2,
    rooms: l.rooms,
    floor: l.floor,
    totalFloors: l.total_floors,
    district: l.district ?? '',
    address: l.address ?? '',
    availableFrom: l.available_from ?? '',
    advertiserType: l.advertiser_type,
    description: l.description ?? '',
    features: (l.features ?? {}) as ListingFeatures,
  }
}

const blank = (s: string) => (s.trim() === '' ? null : s.trim())

/** Columns to update from a draft. A listing stops needing details once the key numbers are in. */
export function draftToUpdate(d: ListingDraft) {
  return {
    title: blank(d.title),
    rent: d.rent,
    admin_fee: d.adminFee,
    utilities_estimate: d.utilitiesEstimate,
    deposit: d.deposit,
    area_m2: d.areaM2,
    rooms: d.rooms,
    floor: d.floor,
    total_floors: d.totalFloors,
    district: blank(d.district),
    address: blank(d.address),
    available_from: blank(d.availableFrom),
    advertiser_type: d.advertiserType,
    description: blank(d.description),
    features: Object.fromEntries(
      Object.entries(d.features).filter(([, v]) => v != null && v !== ''),
    ),
    needs_details: d.rent == null || d.areaM2 == null || d.rooms == null,
  }
}

/** The draft as ParsedListing-shaped fields for the ingest function (text mode). */
export function draftToFields(d: ListingDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(d)) {
    if (k === 'url') continue
    if (k === 'advertiserType' && v === 'unknown') continue
    if (v == null || v === '' || (k === 'features' && Object.keys(v as object).length === 0))
      continue
    out[k] = v
  }
  return out
}

export function listingTotal(l: Pick<Listing, 'rent' | 'admin_fee' | 'utilities_estimate'>) {
  return totalMonthly({
    rent: l.rent,
    adminFee: l.admin_fee,
    utilitiesEstimate: l.utilities_estimate,
  })
}

export async function ingest(body: Record<string, unknown>): Promise<IngestResponse> {
  const { data, error } = await supabase.functions.invoke<IngestResponse>('ingest-listing', {
    body,
  })
  if (error) {
    // FunctionsHttpError carries the JSON body with our error message.
    const ctx = (error as { context?: Response }).context
    const detail = ctx && (await ctx.json().catch(() => null))
    throw new Error(detail?.error ?? error.message)
  }
  return data!
}

/** Sorted photos with the cover first. */
export function sortedPhotos(photos: ListingPhoto[]): ListingPhoto[] {
  return [...photos].sort(
    (a, b) => Number(b.is_cover) - Number(a.is_cover) || a.position - b.position,
  )
}

export const SOURCE_LABELS: Record<ListingSource, string> = {
  otodom: 'Otodom',
  olx: 'OLX',
  gratka: 'Gratka',
  morizon: 'Morizon',
  nieruchomosci_online: 'Nieruchomosci-online',
  domiporta: 'Domiporta',
  facebook: 'Facebook',
  other: 'Other',
}

export function draftFromParsed(p: Partial<ParsedListing>): ListingDraft {
  return {
    ...emptyDraft(),
    title: p.title ?? '',
    url: p.url ?? '',
    rent: p.rent ?? null,
    adminFee: p.adminFee ?? null,
    utilitiesEstimate: p.utilitiesEstimate ?? null,
    deposit: p.deposit ?? null,
    areaM2: p.areaM2 ?? null,
    rooms: p.rooms ?? null,
    floor: p.floor ?? null,
    totalFloors: p.totalFloors ?? null,
    district: p.district ?? '',
    address: p.address ?? '',
    availableFrom: p.availableFrom ?? '',
    advertiserType: p.advertiserType ?? 'unknown',
    description: p.description ?? '',
    features: p.features ?? {},
  }
}
