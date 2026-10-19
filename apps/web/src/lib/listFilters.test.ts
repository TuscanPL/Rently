import { describe, expect, it } from 'vitest'
import type { CriteriaViolation } from '@at/shared'
import {
  activeFilterCount,
  applyListPrefs,
  defaultListPrefs,
  parseListPrefs,
  sortPin,
  type ListPrefs,
} from './listFilters'
import type { ListingWithPhotos } from './listings'
import type { ListingSummary } from './votes'
import type { Pin } from './geo'

function listing(id: string, over: Partial<ListingWithPhotos> = {}): ListingWithPhotos {
  return {
    id,
    hunt_id: 'h',
    created_at: '2026-10-01T10:00:00Z',
    rent: null,
    admin_fee: null,
    utilities_estimate: null,
    area_m2: null,
    lat: null,
    lng: null,
    status: 'new',
    is_active: true,
    needs_details: false,
    listing_photos: [],
    ...over,
  } as ListingWithPhotos
}

function summary(id: string, over: Partial<ListingSummary> = {}): ListingSummary {
  return {
    listing_id: id,
    total_monthly: null,
    my_swipe: null,
    my_stars: null,
    member_votes: [],
    voted_count: 0,
    member_count: 2,
    votes_revealed: false,
    combined_score: null,
    is_match: false,
    is_disagreement: false,
    is_maybe: false,
    reconsider_pending: false,
    still_no: false,
    criteria_violations: [],
    ...over,
  }
}

const pin = (id: string, lat: number, lng: number) =>
  ({ id, hunt_id: 'h', label: id, lat, lng, kind: 'other' }) as Pin

const A = listing('a', {
  created_at: '2026-10-01T10:00:00Z',
  rent: 4000,
  admin_fee: 500,
  area_m2: 50,
  lat: 52.2,
  lng: 21.0,
})
const B = listing('b', {
  created_at: '2026-10-03T10:00:00Z',
  rent: 3500,
  area_m2: 30,
  lat: 52.25,
  lng: 21.0,
  status: 'contacted',
  needs_details: true,
})
const C = listing('c', { created_at: '2026-10-02T10:00:00Z', is_active: false })
const overBudget: CriteriaViolation = { code: 'max_total', limit: 4000, actual: 4500 }
const summaries = {
  a: summary('a', {
    my_swipe: 'yes',
    combined_score: 4,
    is_match: true,
    criteria_violations: [overBudget],
  }),
  b: summary('b', { my_swipe: 'no', combined_score: 4.5 }),
  c: summary('c'),
}
const all = [A, B, C]
const ids = (prefs: Partial<ListPrefs>, pinned: Pin | null = null) =>
  applyListPrefs(all, { ...defaultListPrefs(), ...prefs }, { summaries, pin: pinned }).map(
    (l) => l.id,
  )

describe('applyListPrefs: sort', () => {
  it('defaults to newest first', () => {
    expect(ids({})).toEqual(['b', 'c', 'a'])
  })
  it('sorts by total cost, unknown last', () => {
    expect(ids({ sort: 'total' })).toEqual(['b', 'a', 'c'])
  })
  it('sorts by cost per m²', () => {
    expect(ids({ sort: 'perM2' })).toEqual(['a', 'b', 'c'])
  })
  it('sorts by combined score, best first', () => {
    expect(ids({ sort: 'score' })).toEqual(['b', 'a', 'c'])
  })
  it('sorts by distance to the pin, unlocated last', () => {
    expect(ids({ sort: 'distance' }, pin('p', 52.26, 21.0))).toEqual(['b', 'a', 'c'])
    expect(ids({ sort: 'distance' }, pin('p', 52.19, 21.0))).toEqual(['a', 'b', 'c'])
  })
  it('keeps newest-first order without a pin', () => {
    expect(ids({ sort: 'distance' }, null)).toEqual(['b', 'c', 'a'])
  })
})

describe('applyListPrefs: filters', () => {
  it('filters by status', () => {
    expect(ids({ statuses: ['contacted'] })).toEqual(['b'])
    expect(ids({ statuses: ['new', 'contacted'] })).toEqual(['b', 'c', 'a'])
  })
  it('filters by my vote', () => {
    expect(ids({ myVote: 'yes' })).toEqual(['a'])
    expect(ids({ myVote: 'no' })).toEqual(['b'])
    expect(ids({ myVote: 'unvoted' })).toEqual(['c'])
  })
  it('matches only, criteria violators, inactive ads, needs details', () => {
    expect(ids({ matchesOnly: true })).toEqual(['a'])
    expect(ids({ hideViolators: true })).toEqual(['b', 'c'])
    expect(ids({ hideInactive: true })).toEqual(['b', 'a'])
    expect(ids({ needsDetails: true })).toEqual(['b'])
  })
  it('combines filters', () => {
    expect(ids({ hideInactive: true, hideViolators: true })).toEqual(['b'])
  })
  it('counts active filters', () => {
    expect(activeFilterCount(defaultListPrefs())).toBe(0)
    expect(
      activeFilterCount({ ...defaultListPrefs(), sort: 'total', statuses: ['new'], myVote: 'no' }),
    ).toBe(2)
  })
})

describe('parseListPrefs', () => {
  it('falls back to defaults for missing or broken data', () => {
    expect(parseListPrefs(null)).toEqual(defaultListPrefs())
    expect(parseListPrefs('{not json')).toEqual(defaultListPrefs())
    expect(parseListPrefs('null')).toEqual(defaultListPrefs())
  })
  it('keeps valid values and drops unknown ones', () => {
    const p = parseListPrefs(
      JSON.stringify({
        sort: 'total',
        statuses: ['viewed', 'nope'],
        myVote: 'meh',
        hideInactive: 1,
      }),
    )
    expect(p.sort).toBe('total')
    expect(p.statuses).toEqual(['viewed'])
    expect(p.myVote).toBe('any')
    expect(p.hideInactive).toBe(false)
  })
})

describe('sortPin', () => {
  const pins = [pin('first', 0, 0), pin('crit', 1, 1), pin('chosen', 2, 2)]
  it('prefers the chosen pin, then the criteria pin, then the first', () => {
    expect(sortPin({ ...defaultListPrefs(), pinId: 'chosen' }, pins, 'crit')?.id).toBe('chosen')
    expect(sortPin({ ...defaultListPrefs(), pinId: 'deleted' }, pins, 'crit')?.id).toBe('crit')
    expect(sortPin(defaultListPrefs(), pins)?.id).toBe('first')
    expect(sortPin(defaultListPrefs(), [])).toBeNull()
  })
})
