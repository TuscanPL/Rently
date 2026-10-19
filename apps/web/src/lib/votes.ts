import type { Swipe } from '@at/shared'
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
  /** Filled by milestone 4 (hunt criteria); always empty for now. */
  criteria_violations: unknown[]
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

/** Show the score only once someone has rated; an unrated match scores just the bonus. */
export function hasRatings(s: ListingSummary) {
  return s.combined_score != null && s.member_votes.some((v) => v.stars != null)
}

/** Highest combined score first; unscored last. */
export function byScore(a: ListingSummary, b: ListingSummary) {
  return (b.combined_score ?? -1) - (a.combined_score ?? -1)
}
