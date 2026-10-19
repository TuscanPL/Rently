import { supabase } from './supabase'

export type CheckOutcome = 'unchanged' | 'price_changed' | 'removed' | 'restored' | 'unknown'

/** Re-checks one listing's original ad right now (same throttle as the daily job). */
export async function checkListingNow(listingId: string): Promise<CheckOutcome> {
  const { data, error } = await supabase.functions.invoke<{ outcome: CheckOutcome }>(
    'refresh-listings',
    { body: { listingId } },
  )
  if (error) {
    const ctx = (error as { context?: Response }).context
    const detail = ctx && (await ctx.json().catch(() => null))
    throw new Error(detail?.error ?? error.message)
  }
  return data!.outcome
}

/** Folds `drop` into `keep` (see merge_listings) and returns the kept listing's id. */
export async function mergeListings(keep: string, drop: string): Promise<string> {
  const { data, error } = await supabase.rpc('merge_listings', { p_keep: keep, p_drop: drop })
  if (error) throw new Error(error.message)
  return data
}
