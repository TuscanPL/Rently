import { describe, expect, it } from 'vitest'
import {
  huntUrls,
  inHunt,
  isCurrent,
  isNew,
  sortResults,
  type SavedSearch,
  type SearchResult,
} from './browse'

const search = {
  first_refreshed_at: '2026-10-20T10:00:00Z',
  last_refreshed_at: '2026-10-21T12:00:00Z',
} as SavedSearch
const result = (over: Partial<SearchResult>) =>
  ({
    external_id: '1',
    url: 'https://www.otodom.pl/pl/oferta/flat-ID1',
    first_seen_at: '2026-10-20T10:00:00Z',
    last_seen_at: '2026-10-21T12:00:00Z',
    posted_at: null,
    ...over,
  }) as SearchResult

describe('browse helpers', () => {
  const now = Date.parse('2026-10-21T12:30:00Z')

  it('shows only ads in the latest refresh', () => {
    expect(isCurrent(result({}), search)).toBe(true)
    expect(isCurrent(result({ last_seen_at: '2026-10-20T10:00:00Z' }), search)).toBe(false)
  })

  it('calls an ad new when it appeared after the first refresh, for a day', () => {
    expect(isNew(result({}), search, now)).toBe(false)
    expect(isNew(result({ first_seen_at: '2026-10-21T12:00:00Z' }), search, now)).toBe(true)
    expect(
      isNew(result({ first_seen_at: '2026-10-21T12:00:00Z' }), search, now + 2 * 86400_000),
    ).toBe(false)
  })

  it('recognises ads already in the hunt, merged duplicates included', () => {
    const urls = huntUrls([
      { canonical_url: 'https://otodom.pl/oferta/flat-ID1', merged_urls: [] },
      { canonical_url: null, merged_urls: ['https://otodom.pl/oferta/other-ID2'] },
    ])
    expect(inHunt(result({ url: 'https://www.otodom.pl/pl/oferta/flat-ID1?utm=x' }), urls)).toBe(
      true,
    )
    expect(inHunt(result({ url: 'https://www.otodom.pl/pl/oferta/other-ID2' }), urls)).toBe(true)
    expect(inHunt(result({ url: 'https://www.otodom.pl/pl/oferta/new-ID3' }), urls)).toBe(false)
  })

  it('sorts newest listed first', () => {
    const sorted = sortResults([
      result({ external_id: 'a', posted_at: null }),
      result({ external_id: 'b', posted_at: '2026-10-21T08:00:00Z' }),
      result({ external_id: 'c', posted_at: '2026-10-20T08:00:00Z' }),
    ])
    expect(sorted.map((r) => r.external_id)).toEqual(['b', 'c', 'a'])
  })
})
