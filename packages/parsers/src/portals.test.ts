import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ADAPTERS, parseListingHtml } from './index.ts'
import { districtFrom, floorAndTotal, labelled } from './portal.ts'
import { element, itemprops, textLines } from './html.ts'

// Gratka, Morizon, Nieruchomosci-online and Domiporta: hand-built fixtures (see __fixtures__/README.md).

const fixture = (name: string) =>
  readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), 'utf8')

describe('gratka', () => {
  const url = 'https://gratka.pl/nieruchomosci/mieszkanie-warszawa-mokotow-ul-bokserska/ob/38123456'
  const r = parseListingHtml(fixture('gratka-ad.html'), url)

  it('reads JSON-LD and the parameters list', () => {
    expect(r.listing).toMatchObject({
      source: 'gratka',
      title: 'Mieszkanie 3-pokojowe, Mokotów, blisko SKM Służewiec',
      rent: 3900,
      adminFee: 650,
      deposit: 3900,
      areaM2: 58,
      rooms: 3,
      floor: 2,
      totalFloors: 4,
      address: 'Warszawa, Mokotów, Stegny, ul. Bokserska',
      district: 'Mokotów',
      lat: 52.1789,
      lng: 21.0512,
      availableFrom: '2026-12-01',
      advertiserType: 'private',
    })
    expect(r.listing.features).toMatchObject({
      yearBuilt: 1978,
      furnished: true,
      balcony: true,
      elevator: false,
    })
    expect(r.listing.description).toContain('8 minut pieszo do SKM Służewiec')
    expect(r.confidence).toBe(1)
  })

  it("links this ad's gallery photos in the large size and a medium cover", () => {
    expect(r.listing.photos).toEqual([
      'https://d-gr.cppl.pl/kadry/k/r/gr-ogl/0d/9a/38123456_916234567_mieszkanie-warszawa_large.jpg',
      'https://d-gr.cppl.pl/kadry/k/r/gr-ogl/1f/77/38123456_916234568_mieszkanie-warszawa_large.jpg',
      'https://d-gr.cppl.pl/kadry/k/r/gr-ogl/a2/03/38123456_916234569_mieszkanie-warszawa_large.jpg',
    ])
    expect(r.listing.coverThumbnailUrl).toBe(
      'https://d-gr.cppl.pl/kadry/k/r/gr-ogl/0d/9a/38123456_916234567_mieszkanie-warszawa_medium.jpg',
    )
  })

  it('keeps the JSON-LD node and the detail lines as raw', () => {
    expect(r.raw).toHaveProperty('jsonLd.offers.price', '3900')
    expect((r.raw as { details: string[] }).details).toContain('Liczba pokoi')
  })
})

describe('morizon', () => {
  const url =
    'https://www.morizon.pl/oferta/wynajem-mieszkanie-warszawa-mokotow-wierzbno-odynca-52m2-mzn2041234567'

  it('reads the detailed-information rows', () => {
    const r = parseListingHtml(fixture('morizon-ad.html'), url)
    expect(r.listing).toMatchObject({
      source: 'morizon',
      title: 'Mieszkanie, 52 m², Warszawa, Mokotów',
      rent: 3600,
      adminFee: 550,
      deposit: 7200,
      utilitiesEstimate: 300,
      areaM2: 52,
      rooms: 2,
      floor: 3,
      totalFloors: 6,
      district: 'Mokotów',
      lat: 52.1907,
      lng: 21.0189,
      availableFrom: '2026-11-01',
      advertiserType: 'agency',
      features: { yearBuilt: 2008, elevator: true, parking: true, petsAllowed: true },
    })
    expect(r.confidence).toBe(1)
  })

  it('picks photo sizes from srcset and skips similar offers', () => {
    const r = parseListingHtml(fixture('morizon-ad.html'), url)
    expect(r.listing.photos).toEqual([
      'https://img41.staticmorizon.com.pl/thumbnail/8f/3c/1080x720/mieszkanie-warszawa-mokotow-wierzbno.jpg',
      'https://img41.staticmorizon.com.pl/thumbnail/2a/91/1080x720/mieszkanie-warszawa-mokotow-wierzbno.jpg',
    ])
    expect(r.listing.coverThumbnailUrl).toBe(
      'https://img41.staticmorizon.com.pl/thumbnail/8f/3c/480x320/mieszkanie-warszawa-mokotow-wierzbno.jpg',
    )
  })

  it('reads the older propertyDetails table', () => {
    const r = parseListingHtml(fixture('morizon-old-table.html'), url)
    expect(r.listing).toMatchObject({
      rent: 2900,
      adminFee: 480,
      areaM2: 38.5,
      rooms: 2,
      floor: 4,
      totalFloors: 8,
      lat: 52.2372,
      lng: 20.9913,
    })
    // No gallery: the generic adapter's og:image fills in.
    expect(r.listing.photos).toHaveLength(1)
    expect(r.missingFields).toEqual(['district'])
  })
})

describe('nieruchomosci-online', () => {
  const url = 'https://warszawa.nieruchomosci-online.pl/mieszkanie,na-wynajem/25123456.html'
  const r = parseListingHtml(fixture('nieruchomosci-online-ad.html'), url)

  it('reads the attributes box', () => {
    expect(r.listing).toMatchObject({
      source: 'nieruchomosci_online',
      title: 'Mieszkanie, ul. Lanciego',
      rent: 3200,
      adminFee: 520,
      deposit: 6400,
      areaM2: 47.2,
      rooms: 2,
      floor: 0,
      totalFloors: 4,
      address: 'Warszawa, Ursynów, Natolin, ul. Lanciego',
      district: 'Ursynów',
      lat: 52.1398,
      lng: 21.0592,
      advertiserType: 'agency',
      features: { heating: 'miejskie', yearBuilt: 1987, petsAllowed: false, furnished: true },
    })
    expect(r.listing.availableFrom).toBeUndefined()
    expect(r.listing.description).toContain('5 minut do metra Natolin')
    expect(r.listing.photos).toEqual([
      'https://i.st-nieruchomosci-online.pl/25123456/960x720/a1b2c3.jpg',
      'https://i.st-nieruchomosci-online.pl/25123456/960x720/d4e5f6.jpg',
    ])
    expect(r.listing.coverThumbnailUrl).toBe(
      'https://i.st-nieruchomosci-online.pl/25123456/320x240/a1b2c3.jpg',
    )
    expect(r.confidence).toBe(1)
  })
})

describe('domiporta', () => {
  const url =
    'https://www.domiporta.pl/nieruchomosci/wynajme-mieszkanie-trzypokojowe-warszawa-bielany-63m2/154123456'
  const r = parseListingHtml(fixture('domiporta-ad.html'), url)

  it('reads microdata and the features list', () => {
    expect(r.listing).toMatchObject({
      source: 'domiporta',
      title: 'Mieszkanie trzypokojowe, Bielany, 63 m²',
      rent: 4100,
      adminFee: 780,
      deposit: 4100,
      areaM2: 63,
      rooms: 3,
      floor: 5,
      totalFloors: 10,
      district: 'Bielany',
      lat: 52.2861,
      lng: 20.9573,
      availableFrom: '2026-11-15',
      advertiserType: 'private',
      features: { elevator: true, balcony: true },
    })
    expect(r.listing.photos).toEqual([
      'https://img.domiporta.pl/thumbnails/1024x768/a7/c4/154123456-1.jpg',
      'https://img.domiporta.pl/thumbnails/1024x768/b8/d5/154123456-2.jpg',
    ])
    expect(r.listing.coverThumbnailUrl).toBe(
      'https://img.domiporta.pl/thumbnails/360x270/a7/c4/154123456-1.jpg',
    )
    expect(r.confidence).toBe(1)
  })
})

describe('portal adapters on garbage', () => {
  const urls = [
    'https://gratka.pl/nieruchomosci/x/ob/1',
    'https://www.morizon.pl/oferta/x-mzn1',
    'https://warszawa.nieruchomosci-online.pl/mieszkanie/1.html',
    'https://www.domiporta.pl/nieruchomosci/x/1',
  ]
  const garbage = [
    '',
    '<html',
    '<div class="parameters"><span>Piętro</span>',
    '<div class="gallery"><img src="javascript:alert(1)"><img srcset=", ,">',
    '<script type="application/ld+json">{"@type":"Product","offers":[null],"image":[null,{}]}</script>',
    '<meta itemprop="price"><span itemprop="name">',
    '<div class="features"><div class="features">'.repeat(200),
  ]

  it('never throws and always returns a valid url and source', () => {
    for (const u of urls) {
      expect(ADAPTERS.some((a) => a.matches(new URL(u)))).toBe(true)
      for (const html of garbage) {
        const r = parseListingHtml(html, u)
        expect(r.listing.url).toBe(u)
        expect(r.confidence).toBeLessThan(0.5)
      }
    }
  })
})

describe('portal helpers', () => {
  it('labelled() needs the label alone or followed by a colon', () => {
    const lines = ['Cena za m²: 67 zł', 'Cena', '3 500 zł', 'Kaucja: 1 000 zł']
    expect(labelled(lines, 'Cena')).toBe('3 500 zł')
    expect(labelled(lines, 'Kaucja')).toBe('1 000 zł')
    expect(labelled(['Piętro:', 'Winda:', 'tak'], 'Piętro')).toBeUndefined()
  })

  it('floorAndTotal() reads the usual notations', () => {
    expect(floorAndTotal('3/5')).toEqual({ floor: 3, totalFloors: 5 })
    expect(floorAndTotal('parter / 4')).toEqual({ floor: 0, totalFloors: 4 })
    expect(floorAndTotal('4 (z 8)')).toEqual({ floor: 4, totalFloors: 8 })
    expect(floorAndTotal('2 z 10')).toEqual({ floor: 2, totalFloors: 10 })
    expect(floorAndTotal('7')).toEqual({ floor: 7, totalFloors: undefined })
  })

  it('districtFrom() takes the part next to the city', () => {
    expect(districtFrom('Warszawa, Mokotów, Stegny, ul. Bokserska')).toBe('Mokotów')
    expect(districtFrom('ul. Bokserska, Mokotów, Warszawa', 'Warszawa')).toBe('Mokotów')
    expect(districtFrom('mazowieckie, Warszawa, Bielany')).toBe('Bielany')
    expect(districtFrom('Warszawa')).toBeUndefined()
  })

  it('element() balances nested tags', () => {
    const html = '<div class="a"><div>x</div><div>y</div></div><div class="b">z</div>'
    expect(element(html, 'class', /^a$/)).toBe('<div>x</div><div>y</div>')
    expect(textLines(html)).toEqual(['x', 'y', 'z'])
  })

  it('itemprops() reads content, src and text', () => {
    const md = itemprops(
      '<span itemprop="name">Flat &amp; co</span><meta itemprop="price" content="3500"><img itemprop="image" src="https://x/1.jpg"><div itemprop="offers" itemscope></div>',
    )
    expect(md.get('name')).toEqual(['Flat & co'])
    expect(md.get('price')).toEqual(['3500'])
    expect(md.get('image')).toEqual(['https://x/1.jpg'])
    expect(md.has('offers')).toBe(false)
  })
})
