import { LISTING_STATUSES, type ListingStatus } from '@at/shared'

// The status pipeline: new → contacted → viewing_booked → viewed → applied → won | rejected | gone.

export const PIPELINE_COLUMNS: readonly ListingStatus[] = LISTING_STATUSES

export const STATUS_CLASSES: Record<ListingStatus, string> = {
  new: 'bg-slate-200 text-slate-700',
  contacted: 'bg-sky-100 text-sky-800',
  viewing_booked: 'bg-violet-100 text-violet-800',
  viewed: 'bg-indigo-100 text-indigo-800',
  applied: 'bg-amber-100 text-amber-800',
  won: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
  gone: 'bg-slate-300 text-slate-700',
}

/** Statuses after the viewing, where each member is asked for a viewing note. */
export const AFTER_VIEWING: readonly ListingStatus[] = ['viewed', 'applied', 'won']

export function wantsViewingNote(status: ListingStatus): boolean {
  return AFTER_VIEWING.includes(status)
}
