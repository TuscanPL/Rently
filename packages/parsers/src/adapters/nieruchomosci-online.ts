import type { SiteAdapter } from '../types.ts'
import { element, elementText, h1, imageCandidates } from '../html.ts'
import { galleryOr, portalResult, sitePhotos } from '../portal.ts'

/**
 * nieruchomosci-online.pl (ads live on city subdomains, e.g.
 * warszawa.nieruchomosci-online.pl/mieszkanie,na-wynajem/25123456.html): JSON-LD
 * or microdata when present, then the attributes box ("Powierzchnia:" / "47,20 m²")
 * and the price header.
 */
export const nieruchomosciOnlineAdapter: SiteAdapter = {
  name: 'nieruchomosci-online',
  matches: (url) => /(^|\.)nieruchomosci-online\.pl$/i.test(url.hostname),
  parse(html, url) {
    const gallery = element(html, 'id', /^gallery/) ?? element(html, 'class', /\bgallery\b/) ?? ''
    return portalResult(url, html, 'nieruchomosci_online', {
      details:
        element(html, 'id', /^attributesTable$/) ?? element(html, 'class', /\bbox__attributes\b/),
      title: h1(html),
      price: elementText(html, 'class', /\binfo-primary-price\b/),
      location: elementText(html, 'class', /\binfo-location\b/),
      descriptionHtml: element(html, 'id', /^description$/),
      ...sitePhotos(galleryOr(imageCandidates(gallery), html), {
        cdn: /(^|\.)(st-nieruchomosci-online\.pl|nieruchomosci-online\.pl)$/i,
      }),
    })
  },
}
