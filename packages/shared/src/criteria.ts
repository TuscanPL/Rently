// What hunt_listing_summaries.criteria_violations holds: one entry per hunt
// criterion a listing breaks. Computed in SQL (listing_criteria_violations in
// supabase/migrations/20261023000000_organize.sql); keep the two in sync.

export type CriteriaViolation =
  | { code: 'max_total'; limit: number; actual: number }
  | { code: 'min_rooms'; limit: number; actual: number }
  | { code: 'min_area'; limit: number; actual: number }
  | { code: 'district'; actual: string; allowed: string[] }
  | { code: 'max_distance'; limit: number; actual: number; pin_id: string; pin_label: string }
  | { code: 'private_only' }
  | { code: 'pets' }
  /** `actual`, `from` and `to` are ISO dates; either end of the window may be open. */
  | { code: 'available_from'; actual: string; from: string | null; to: string | null }
  | { code: 'parking' }
  | { code: 'balcony' }
  | { code: 'elevator'; floor: number; limit: number }

export type CriteriaViolationCode = CriteriaViolation['code']

/** Post-viewing ratings, stored in comments.ratings for viewing notes. */
export const VIEWING_ASPECTS = ['smell', 'light', 'noise', 'landlord'] as const
export type ViewingAspect = (typeof VIEWING_ASPECTS)[number]

export const VIEWING_RATINGS = ['good', 'ok', 'bad'] as const
export type ViewingRating = (typeof VIEWING_RATINGS)[number]

export type ViewingRatings = Partial<Record<ViewingAspect, ViewingRating>>
