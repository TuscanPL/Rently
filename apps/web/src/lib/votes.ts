import type { CriteriaViolation, Swipe } from '@at/shared'
import type { ListingWithPhotos } from './listings'

/** One member's vote as hunt_listing_summaries reports it. Stars are null while hidden. */
export interface MemberVote {
  user_id: string
  display_name: string
  swipe: Swipe | null
  stars: number | null
}

/** A row of hunt_listing_summaries (the spec's listing_summary). */
export interface ListingSummary {
  listing_id: string
  total_monthly: number | null
  my_swipe: Swipe | null
  my_stars: number | null
  member_votes: MemberVote[]
  voted_count: number
  member_count: number
  votes_revealed: boolean
  combined_score: number | null
  is_match: boolean
  is_disagreement: boolean
  is_maybe: boolean
  reconsider_pending: boolean
  still_no: boolean
  /** Hunt criteria this listing breaks (see packages/shared/src/criteria.ts). */
  criteria_violations: CriteriaViolation[]
}

/** A row of next_deck_cards. Group 1: reconsider request for me, 2: fresh, 3: rejected by someone. */
export interface DeckEntry {
  listing_id: string
  deck_group: 1 | 2 | 3
  reconsider_request_id: string | null
  reconsider_note: string | null
  reconsider_requested_by: string | null
  rejected_by: string[]
  reconsider_pending: boolean
  still_no: boolean
}

export type DeckCard = DeckEntry & { listing: ListingWithPhotos }

export const SWIPE_ICONS: Record<Swipe, string> = { yes: '✓', maybe: '?', no: '✗' }
