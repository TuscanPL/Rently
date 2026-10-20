import { describe, expect, it } from 'vitest'
import { distanceBetween, distanceKm, formatDistance, geocodeQuery, hasCoords } from './distance.ts'

const SLUZEWIEC = { lat: 52.1808, lng: 20.9997 }
const RAKOWIEC = { lat: 52.2003, lng: 20.9775 }

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm(SLUZEWIEC, SLUZEWIEC)).toBe(0)
  })
  it('measures short distances within Warsaw', () => {
    // About 2.6 km between the two SKM stops.
    expect(distanceKm(SLUZEWIEC, RAKOWIEC)).toBeCloseTo(2.64, 2)
  })
  it('measures long distances', () => {
    const krakow = { lat: 50.0647, lng: 19.945 }
    expect(distanceKm({ lat: 52.2297, lng: 21.0122 }, krakow)).toBeCloseTo(252, 0)
  })
  it('is symmetric', () => {
    expect(distanceKm(SLUZEWIEC, RAKOWIEC)).toBeCloseTo(distanceKm(RAKOWIEC, SLUZEWIEC), 10)
  })
})

describe('distanceBetween', () => {
  it('is null when a side has no coordinates', () => {
    expect(distanceBetween({ lat: null, lng: null }, SLUZEWIEC)).toBeNull()
    expect(distanceBetween(SLUZEWIEC, undefined)).toBeNull()
  })
  it('measures when both have coordinates', () => {
    expect(distanceBetween(SLUZEWIEC, RAKOWIEC)).toBeGreaterThan(2)
  })
})

describe('hasCoords', () => {
  it('accepts zero coordinates', () => {
    expect(hasCoords({ lat: 0, lng: 0 })).toBe(true)
    expect(hasCoords({ lat: 52, lng: null })).toBe(false)
  })
})

describe('formatDistance', () => {
  const fmt = (km: number) => formatDistance(km).replace(/\s/g, ' ')
  it('shows metres under 1 km, rounded to 10 m', () => {
    expect(fmt(0.853)).toBe('850 m')
    expect(fmt(0.004)).toBe('0 m')
  })
  it('switches to km with a Polish decimal comma', () => {
    expect(fmt(0.996)).toBe('1,0 km')
    expect(fmt(1.234)).toBe('1,2 km')
    expect(fmt(9.94)).toBe('9,9 km')
  })
  it('drops decimals from 10 km on', () => {
    expect(fmt(9.96)).toBe('10 km')
    expect(fmt(14.4)).toBe('14 km')
    expect(fmt(1234)).toBe('1 234 km')
  })
  it('shows a dash for unknown', () => {
    expect(formatDistance(null)).toBe('—')
  })
})

describe('geocodeQuery', () => {
  it('joins address, district and city', () => {
    expect(geocodeQuery('Puławska 145', 'Mokotów', 'Warszawa')).toBe(
      'Puławska 145, Mokotów, Warszawa',
    )
  })
  it('skips blanks and parts already mentioned', () => {
    expect(geocodeQuery(' ul.  Puławska 145, Mokotów ', null, 'mokotów', '', 'Warszawa')).toBe(
      'ul. Puławska 145, Mokotów, Warszawa',
    )
    expect(geocodeQuery(null, undefined)).toBe('')
  })
})
