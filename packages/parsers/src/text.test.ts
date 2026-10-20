import { describe, expect, it } from 'vitest'
import { extractFromText } from './text.ts'

describe('extractFromText', () => {
  it('reads a typical Facebook group post', () => {
    const post = `Wynajmę mieszkanie 3 pokojowe, Mokotów, ul. Puławska
62 m2, 4 piętro / 6, winda, balkon.
Cena: 4 200 zł + czynsz administracyjny 750 zł + media ok. 300 zł.
Kaucja 4200 zł. Bez pośredników. Zwierzęta mile widziane.`
    const r = extractFromText(post)
    expect(r).toMatchObject({
      rent: 4200,
      adminFee: 750,
      utilitiesEstimate: 300,
      deposit: 4200,
      areaM2: 62,
      rooms: 3,
      floor: 4,
      totalFloors: 6,
      advertiserType: 'private',
      features: { petsAllowed: true, balcony: true, elevator: true },
    })
    expect(r.title).toBe('Wynajmę mieszkanie 3 pokojowe, Mokotów, ul. Puławska')
  })

  it('falls back to the first unlabelled amount for rent', () => {
    const r = extractFromText('Kawalerka 28,5 m², parter. 2800 zł/mies. + czynsz 400 zł')
    expect(r).toMatchObject({ rent: 2800, adminFee: 400, areaM2: 28.5, rooms: 1, floor: 0 })
  })

  it('handles word room counts and amounts with dots', () => {
    const r = extractFromText('Przestronne trzypokojowe, 3.900 zł, kaucja 7.800 zł, bez zwierząt')
    expect(r).toMatchObject({
      rooms: 3,
      rent: 3900,
      deposit: 7800,
      features: { petsAllowed: false },
    })
  })

  it('returns nothing it is not sure about', () => {
    const r = extractFromText('Hej, ktoś coś poleci na Ursynowie?')
    expect(r.rent).toBeUndefined()
    expect(r.areaM2).toBeUndefined()
    expect(r.rooms).toBeUndefined()
  })
})
