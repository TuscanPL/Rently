import { describe, expect, it } from 'vitest'
import { canonicalizeUrl, firstUrl, sourceForUrl, titleFromUrl } from './url.ts'

describe('canonicalizeUrl', () => {
  it('drops every query param and www on listing sites', () => {
    expect(
      canonicalizeUrl(
        'http://www.otodom.pl/pl/oferta/mieszkanie-3-pok-ID4qWer?utm_source=x&reason=y#gallery',
      ),
    ).toBe('https://otodom.pl/oferta/mieszkanie-3-pok-ID4qWer')
    expect(
      canonicalizeUrl('https://m.olx.pl/d/oferta/flat-CID3-IDabc.html?bs=olx_pro_listing'),
    ).toBe('https://olx.pl/d/oferta/flat-CID3-IDabc.html')
  })
  it('keeps meaningful params elsewhere but strips tracking', () => {
    expect(
      canonicalizeUrl('https://www.facebook.com/groups/123/posts/456/?mibextid=abc&b=2&a=1'),
    ).toBe('https://facebook.com/groups/123/posts/456?a=1&b=2')
  })
})

describe('sourceForUrl', () => {
  it('maps domains', () => {
    expect(sourceForUrl('https://www.otodom.pl/pl/oferta/x')).toBe('otodom')
    expect(sourceForUrl('https://www.nieruchomosci-online.pl/x')).toBe('nieruchomosci_online')
    expect(sourceForUrl('https://m.facebook.com/x')).toBe('facebook')
    expect(sourceForUrl('https://example.com')).toBe('other')
    expect(sourceForUrl('not a url')).toBe('other')
  })
})

describe('firstUrl', () => {
  it('pulls the link out of shared text', () => {
    expect(firstUrl('Zobacz to ogłoszenie: https://www.otodom.pl/pl/oferta/x-ID1. Fajne!')).toBe(
      'https://www.otodom.pl/pl/oferta/x-ID1',
    )
    expect(firstUrl('no link')).toBeUndefined()
  })
})

describe('titleFromUrl', () => {
  it('turns a slug into words', () => {
    expect(
      titleFromUrl('https://www.otodom.pl/pl/oferta/mieszkanie-3-pokoje-mokotow-ID4qWer'),
    ).toBe('Mieszkanie 3 pokoje mokotow')
  })
})
