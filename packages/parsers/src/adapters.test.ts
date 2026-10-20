import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseListingHtml, resultFromUrlOnly } from './index.ts'

const fixture = (name: string) =>
  readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), 'utf8')

describe('otodom', () => {
  const url = 'https://www.otodom.pl/pl/oferta/3-pokoje-64-m-mokotow-blisko-skm-ID4tAbC'
  const r = parseListingHtml(fixture('otodom-ad.html'), url)

  it('reads the ad from __NEXT_DATA__', () => {
    expect(r.listing).toMatchObject({
      source: 'otodom',
      title: '3 pokoje, 64 m², Mokotów, blisko SKM Służewiec',
      rent: 4300,
      adminFee: 780,
      deposit: 4300,
      areaM2: 64.2,
      rooms: 3,
      floor: 4,
      totalFloors: 7,
      address: 'ul. Bokserska 12, Mokotów, Warszawa',
      district: 'Mokotów',
      lat: 52.1812,
      lng: 21.0034,
      availableFrom: '2026-11-15',
      advertiserType: 'private',
    })
    expect(r.listing.features).toMatchObject({
      elevator: true,
      balcony: true,
      parking: true,
      furnished: true,
      yearBuilt: 2012,
      heating: 'urban',
    })
    expect(r.confidence).toBe(1)
    expect(r.missingFields).toEqual([])
  })

  it('fills gaps from the description text', () => {
    expect(r.listing.utilitiesEstimate).toBe(350)
    expect(r.listing.features?.petsAllowed).toBe(true)
    expect(r.listing.description).toContain('Do wynajęcia 3-pokojowe mieszkanie.')
  })

  it('links medium photos and picks a small cover', () => {
    expect(r.listing.photos).toEqual([
      'https://ireland.apollo.olxcdn.com/v1/files/aaa-PL/image;s=655x491;q=80',
      'https://ireland.apollo.olxcdn.com/v1/files/bbb-PL/image;s=655x491;q=80',
    ])
    expect(r.listing.coverThumbnailUrl).toBe(
      'https://ireland.apollo.olxcdn.com/v1/files/aaa-PL/image;s=314x236;q=80',
    )
  })

  it('keeps a trimmed raw payload', () => {
    expect(r.raw).toHaveProperty('target.Price', 4300)
    expect(JSON.stringify(r.raw).length).toBeLessThan(40_000)
  })
})

describe('olx', () => {
  const url = 'https://www.olx.pl/d/oferta/mieszkanie-2-pokoje-wola-CID3-IDZz1aB.html'

  it('reads __PRERENDERED_STATE__', () => {
    const r = parseListingHtml(fixture('olx-ad.html'), url)
    expect(r.listing).toMatchObject({
      source: 'olx',
      title: 'Mieszkanie 2 pokoje Wola, bez pośredników',
      rent: 3500,
      adminFee: 600,
      deposit: 3500,
      utilitiesEstimate: 250,
      areaM2: 45,
      rooms: 2,
      floor: 3,
      district: 'Wola',
      lat: 52.2301,
      lng: 20.9842,
      advertiserType: 'private',
      features: { furnished: true, petsAllowed: false },
    })
    expect(r.listing.photos?.[0]).toBe(
      'https://ireland.apollo.olxcdn.com:443/v1/files/ccc-PL/image;s=1280x960',
    )
    expect(r.listing.coverThumbnailUrl).toBe(
      'https://ireland.apollo.olxcdn.com:443/v1/files/ccc-PL/image;s=400x300',
    )
    expect(r.confidence).toBe(1)
  })

  it('falls back to JSON-LD and description text', () => {
    const r = parseListingHtml(fixture('olx-jsonld-only.html'), url)
    expect(r.listing).toMatchObject({
      title: 'Kawalerka Ochota 28 m2',
      rent: 2700,
      adminFee: 450,
      areaM2: 28,
      rooms: 1,
      floor: 2,
    })
    expect(r.listing.photos).toHaveLength(1)
    expect(r.missingFields).toEqual(['district'])
  })
})

describe('generic', () => {
  it('reads schema.org JSON-LD', () => {
    const r = parseListingHtml(
      fixture('generic-jsonld.html'),
      'https://www.domiporta.pl/oferta/123',
    )
    expect(r.listing).toMatchObject({
      source: 'domiporta',
      title: 'Apartament 4 pokoje Ursynów',
      rent: 5200,
      adminFee: 900,
      areaM2: 82.5,
      rooms: 4,
      district: 'Ursynów',
      address: 'ul. Rosoła 10, Ursynów, Warszawa',
      lat: 52.15,
      lng: 21.045,
      photos: ['https://cdn.example.pl/1.jpg', 'https://cdn.example.pl/2.jpg'],
    })
  })

  it('reads OpenGraph and the text in og:description', () => {
    const r = parseListingHtml(fixture('generic-og.html'), 'https://example.com/flat?id=7')
    expect(r.listing).toMatchObject({
      source: 'other',
      title: 'Mieszkanie 3 pokoje, Bielany & metro',
      rent: 3900,
      adminFee: 650,
      areaM2: 58,
      rooms: 3,
      advertiserType: 'private',
      photos: ['https://img.example.com/a.jpg', 'https://img.example.com/b.jpg'],
    })
    expect(r.missingFields).toEqual(['district'])
  })

  it('never throws on garbage', () => {
    const r = parseListingHtml(
      '<html><script id="__NEXT_DATA__">{not json',
      'https://www.otodom.pl/pl/oferta/flat-ID1',
    )
    expect(r.listing.source).toBe('otodom')
    expect(r.confidence).toBeLessThan(0.5)
  })
})

describe('resultFromUrlOnly', () => {
  it('keeps the url and a slug title', () => {
    const r = resultFromUrlOnly('https://www.otodom.pl/pl/oferta/kawalerka-zoliborz-ID9x')
    expect(r.listing).toMatchObject({ source: 'otodom', title: 'Kawalerka zoliborz' })
    expect(r.confidence).toBeCloseTo(1 / 6, 2)
  })
})
