import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isOtodomSearchUrl, otodomSearchPageUrl, parseOtodomSearch } from './otodom.ts'

const SEARCH_URL =
  'https://www.otodom.pl/pl/wyniki/wynajem/mieszkanie/mazowieckie/warszawa/warszawa/warszawa?roomsNumber=%5BTHREE%5D&ownerTypeSingleSelect=PRIVATE'
const html = readFileSync(new URL('../../__fixtures__/otodom-search.html', import.meta.url), 'utf8')

describe('parseOtodomSearch', () => {
  const page = parseOtodomSearch(html, SEARCH_URL)

  it('reads every usable ad from the result list', () => {
    expect(page.items.map((i) => i.externalId)).toEqual(['66500001', '66500002', '66500003'])
    expect(page).toMatchObject({ page: 1, totalPages: 3, totalResults: 95 })
  })

  it('reads the baseline fields of a private ad', () => {
    expect(page.items[0]).toEqual({
      externalId: '66500001',
      url: 'https://www.otodom.pl/pl/oferta/3-pokoje-balkon-blisko-skm-sluzewiec-ID4uAAA',
      title: '3 pokoje, balkon, blisko SKM Służewiec',
      rent: 4300,
      adminFee: 780,
      areaM2: 64.2,
      rooms: 3,
      floor: 4,
      district: 'Mokotów',
      address: 'ul. Bokserska 12, Warszawa',
      privateOwner: true,
      photos: [
        'https://ireland.apollo.olxcdn.com/v1/files/a1-PL/image;s=1280x1024;q=80',
        'https://ireland.apollo.olxcdn.com/v1/files/a2-PL/image;s=1280x1024;q=80',
      ],
      postedAt: '2026-10-18 09:00:00',
    })
  })

  it('handles agencies, the ground floor and missing prices', () => {
    expect(page.items[1]).toMatchObject({ privateOwner: false, floor: 0, rooms: 1, adminFee: null })
    expect(page.items[2]).toMatchObject({ rent: null, rooms: null, photos: [], district: null })
  })

  it('gives no items, not an error, for a page it cannot read', () => {
    expect(parseOtodomSearch('<html>blocked</html>', SEARCH_URL)).toMatchObject({
      items: [],
      totalPages: 1,
    })
  })
})

describe('search URLs', () => {
  it('tells search pages from single ads', () => {
    expect(isOtodomSearchUrl(SEARCH_URL)).toBe(true)
    expect(isOtodomSearchUrl('https://www.otodom.pl/pl/oferta/flat-ID4uAAA')).toBe(false)
    expect(isOtodomSearchUrl('https://www.olx.pl/nieruchomosci/')).toBe(false)
    expect(isOtodomSearchUrl('not a url')).toBe(false)
  })

  it('sets the result page, keeping the filters', () => {
    const p2 = new URL(otodomSearchPageUrl(SEARCH_URL, 2))
    expect(p2.searchParams.get('page')).toBe('2')
    expect(p2.searchParams.get('ownerTypeSingleSelect')).toBe('PRIVATE')
    expect(new URL(otodomSearchPageUrl(p2.toString(), 1)).searchParams.has('page')).toBe(false)
  })
})
