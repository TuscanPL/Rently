import {
  costPerM2,
  distanceBetween,
  LISTING_STATUSES,
  totalMonthly,
  type ListingStatus,
} from '@at/shared'
import type { ListingWithPhotos } from './listings'
import type { ListingSummary } from './votes'
import type { Pin } from './geo'
import { readLocal, writeLocal } from './storage'

// The List tab's sort and filters, as pure functions so they're easy to test.

export const SORT_KEYS = ['added', 'total', 'perM2', 'distance'] as const
export type SortKey = (typeof SORT_KEYS)[number]

export const VOTE_FILTERS = ['any', 'yes', 'maybe', 'no', 'unvoted'] as const
export type VoteFilter = (typeof VOTE_FILTERS)[number]

export interface ListPrefs {
  sort: SortKey
  /** Pin for the distance sort; null picks the criteria pin or the first pin. */
  pinId: string | null
  /** Empty: every status. */
  statuses: ListingStatus[]
  myVote: VoteFilter
  matchesOnly: boolean
  hideViolators: boolean
  hideInactive: boolean
  needsDetails: boolean
}

export function defaultListPrefs(): ListPrefs {
  return {
    sort: 'added',
    pinId: null,
    statuses: [],
    myVote: 'any',
    matchesOnly: false,
    hideViolators: false,
    hideInactive: false,
    needsDetails: false,
  }
}

/** How many filters narrow the list (the sort doesn't count). */
export function activeFilterCount(p: ListPrefs): number {
  return (
    (p.statuses.length ? 1 : 0) +
    (p.myVote !== 'any' ? 1 : 0) +
    [p.matchesOnly, p.hideViolators, p.hideInactive, p.needsDetails].filter(Boolean).length
  )
}

const includes = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T)

/** Reads stored prefs, keeping only values that still make sense. */
export function parseListPrefs(raw: string | null): ListPrefs {
  const prefs = defaultListPrefs()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw ?? '{}') ?? {}
  } catch {
    return prefs
  }
  if (typeof data !== 'object') return prefs
  if (includes(SORT_KEYS, data.sort)) prefs.sort = data.sort
  if (typeof data.pinId === 'string') prefs.pinId = data.pinId
  if (Array.isArray(data.statuses))
    prefs.statuses = data.statuses.filter((s) => includes(LISTING_STATUSES, s))
  if (includes(VOTE_FILTERS, data.myVote)) prefs.myVote = data.myVote
  for (const key of ['matchesOnly', 'hideViolators', 'hideInactive', 'needsDetails'] as const) {
    if (typeof data[key] === 'boolean') prefs[key] = data[key]
  }
  return prefs
}

const prefsKey = (huntId: string) => `at.listPrefs.${huntId}`

export function loadListPrefs(huntId: string): ListPrefs {
  return parseListPrefs(readLocal(prefsKey(huntId)))
}

export function saveListPrefs(huntId: string, prefs: ListPrefs) {
  writeLocal(prefsKey(huntId), JSON.stringify(prefs))
}

/** The pin the distance sort measures to. */
export function sortPin(prefs: ListPrefs, pins: Pin[], criteriaPinId?: string | null): Pin | null {
  return (
    pins.find((p) => p.id === prefs.pinId) ??
    pins.find((p) => p.id === criteriaPinId) ??
    pins[0] ??
    null
  )
}

export interface ListContext {
  summaries: Record<string, ListingSummary>
  pin: Pin | null
}

function matches(l: ListingWithPhotos, p: ListPrefs, s: ListingSummary | undefined): boolean {
  if (p.statuses.length && !p.statuses.includes(l.status)) return false
  if (p.myVote === 'unvoted' && s?.my_swipe) return false
  if (p.myVote !== 'any' && p.myVote !== 'unvoted' && s?.my_swipe !== p.myVote) return false
  if (p.matchesOnly && !s?.is_match) return false
  if (p.hideViolators && s?.criteria_violations.length) return false
  if (p.hideInactive && !l.is_active) return false
  if (p.needsDetails && !l.needs_details) return false
  return true
}

const costs = (l: ListingWithPhotos) => ({
  rent: l.rent,
  adminFee: l.admin_fee,
  utilitiesEstimate: l.utilities_estimate,
})

/** The sort value of a listing; null sorts last whatever the direction. */
function sortValue(l: ListingWithPhotos, p: ListPrefs, ctx: ListContext): number | null {
  switch (p.sort) {
    case 'added':
      return -Date.parse(l.created_at)
    case 'total':
      return totalMonthly(costs(l))
    case 'perM2':
      return costPerM2({ ...costs(l), areaM2: l.area_m2 })
    case 'distance':
      return distanceBetween(l, ctx.pin)
  }
}

/** Filters, then sorts: newest, cheapest or nearest first. */
export function applyListPrefs(
  listings: ListingWithPhotos[],
  prefs: ListPrefs,
  ctx: ListContext,
): ListingWithPhotos[] {
  return listings
    .filter((l) => matches(l, prefs, ctx.summaries[l.id]))
    .map((l) => ({ l, v: sortValue(l, prefs, ctx) }))
    .sort((a, b) => {
      if (a.v != null && b.v != null && a.v !== b.v) return a.v - b.v
      if ((a.v == null) !== (b.v == null)) return a.v == null ? 1 : -1
      // Ties and unknowns: newest first.
      return Date.parse(b.l.created_at) - Date.parse(a.l.created_at)
    })
    .map(({ l }) => l)
}
