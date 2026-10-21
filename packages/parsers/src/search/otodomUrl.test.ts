import { describe, expect, it } from 'vitest'
import { buildOtodomSearchUrl, otodomCityFor, withNewestFirst } from './otodomUrl.ts'
import { isOtodomSearchUrl } from './otodom.ts'

const base = {
  city: 'warszawa',
  district: null,
  priceMax: null,
  roomsMin: null,
  roomsMax: null,
  areaMin: null,
  privateOnly: false,
}

describe('buildOtodomSearchUrl', () => {
  it('builds a whole-city search, newest first', () => {
    const url = new URL(buildOtodomSearchUrl(base))
    expect(url.pathname).toBe(
      '/pl/wyniki/wynajem/mieszkanie/mazowieckie/warszawa/warszawa/warszawa',
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ownerTypeSingleSelect: 'ALL',
      by: 'LATEST',
      direction: 'DESC',
      viewType: 'listing',
    })
    expect(isOtodomSearchUrl(url.toString())).toBe(true)
  })

  it('puts the district in the path and the filters in the query', () => {
    const url = new URL(
      buildOtodomSearchUrl({
        ...base,
        district: 'mokotow',
        priceMax: 5000,
        roomsMin: 3,
        roomsMax: 4,
        areaMin: 55.5,
        privateOnly: true,
      }),
    )
    expect(url.pathname.endsWith('/warszawa/mokotow')).toBe(true)
    expect(url.searchParams.get('priceMax')).toBe('5000')
    expect(url.searchParams.get('areaMin')).toBe('56')
    expect(url.searchParams.get('roomsNumber')).toBe('[THREE,FOUR]')
    expect(url.searchParams.get('ownerTypeSingleSelect')).toBe('PRIVATE')
  })

  it('reads "3 rooms or more" as THREE up to TEN', () => {
    const url = new URL(buildOtodomSearchUrl({ ...base, roomsMin: 3 }))
    expect(url.searchParams.get('roomsNumber')).toBe('[THREE,FOUR,FIVE,SIX,SEVEN,EIGHT,NINE,TEN]')
    expect(
      new URL(buildOtodomSearchUrl({ ...base, roomsMax: 1 })).searchParams.get('roomsNumber'),
    ).toBe('[ONE]')
  })

  it('ignores an unknown district and refuses an unknown city', () => {
    expect(new URL(buildOtodomSearchUrl({ ...base, district: 'nowhere' })).pathname).toMatch(
      /warszawa\/warszawa$/,
    )
    expect(() => buildOtodomSearchUrl({ ...base, city: 'atlantis' })).toThrow()
  })
})

describe('helpers', () => {
  it('maps hunt city names to Otodom cities', () => {
    expect(otodomCityFor('Warszawa')).toBe('warszawa')
    expect(otodomCityFor(' Kraków ')).toBe('krakow')
    expect(otodomCityFor('Łódź')).toBe('lodz')
    expect(otodomCityFor('Sopot')).toBeNull()
  })

  it('makes a pasted link newest first unless it picks an order', () => {
    const pasted = 'https://www.otodom.pl/pl/wyniki/wynajem/mieszkanie/warszawa?priceMax=4000'
    expect(new URL(withNewestFirst(pasted)).searchParams.get('by')).toBe('LATEST')
    const sorted = `${pasted}&by=PRICE&direction=ASC`
    expect(withNewestFirst(sorted)).toBe(sorted)
  })
})
