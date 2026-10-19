import type { Tables } from './supabase'

type PricePoint = Pick<Tables<'listing_price_history'>, 'rent' | 'admin_fee' | 'observed_at'>

/** How long a price change keeps its badge. */
export const PRICE_BADGE_DAYS = 14

/**
 * The latest price change of a listing: its newest history entry against the
 * one before, if the newest is recent. Rent and admin fee are added up; an
 * admin fee missing on either side is left out. Null when there's no change to show.
 */
export function latestPriceChange(
  history: PricePoint[],
  now: Date = new Date(),
): { delta: number; at: string } | null {
  if (history.length < 2) return null
  const sorted = [...history].sort(
    (a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime(),
  )
  const latest = sorted[sorted.length - 1]!
  const previous = sorted[sorted.length - 2]!
  if (now.getTime() - new Date(latest.observed_at).getTime() > PRICE_BADGE_DAYS * 86_400_000) {
    return null
  }
  if (latest.rent == null || previous.rent == null) return null
  const fees =
    latest.admin_fee != null && previous.admin_fee != null
      ? Number(latest.admin_fee) - Number(previous.admin_fee)
      : 0
  const delta = Math.round(Number(latest.rent) - Number(previous.rent) + fees)
  return delta === 0 ? null : { delta, at: latest.observed_at }
}
