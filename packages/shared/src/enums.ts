// Mirrors the Postgres enums in supabase/migrations. Keep the two in sync.

export const HUNT_ROLES = ['owner', 'member'] as const
export type HuntRole = (typeof HUNT_ROLES)[number]

export const PIN_KINDS = ['work', 'station', 'family', 'other'] as const
export type PinKind = (typeof PIN_KINDS)[number]

export const LISTING_SOURCES = [
  'otodom',
  'olx',
  'gratka',
  'morizon',
  'nieruchomosci_online',
  'domiporta',
  'facebook',
  'other',
] as const
export type ListingSource = (typeof LISTING_SOURCES)[number]

export const ADVERTISER_TYPES = ['private', 'agency', 'unknown'] as const
export type AdvertiserType = (typeof ADVERTISER_TYPES)[number]

export const LISTING_STATUSES = [
  'new',
  'contacted',
  'viewing_booked',
  'viewed',
  'applied',
  'won',
  'rejected',
  'gone',
] as const
export type ListingStatus = (typeof LISTING_STATUSES)[number]

export const SWIPES = ['yes', 'maybe', 'no'] as const
export type Swipe = (typeof SWIPES)[number]

export const COMMENT_KINDS = ['comment', 'viewing_note'] as const
export type CommentKind = (typeof COMMENT_KINDS)[number]
