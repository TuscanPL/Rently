import type { SiteAdapter } from '../types.ts'
import { element, elementText, h1, imageCandidates } from '../html.ts'
import { galleryOr, portalResult, sitePhotos } from '../portal.ts'

/**
 * morizon.pl: JSON-LD when present, then the "detailed-information" label/value
 * rows (older pages: the propertyDetails table), the price row and the location
 * heading. Coordinates come from the map's data-lat/data-lng or the Nuxt state.
 */
export const morizonAdapter: SiteAdapter = {
  name: 'morizon',
  matches: (url) => /(^|\.)morizon\.pl$/i.test(url.hostname),
  parse(html, url) {
    const gallery = element(html, 'class', /\bgallery\b/) ?? ''
    return portalResult(url, html, 'morizon', {
      details: element(html, 'class', /\b(detailed-information|propertyDetails)\b/),
      title: h1(html),
      price: elementText(html, 'class', /\b(price-row__price|summaryPrice)\b/),
      location: elementText(html, 'class', /\blocation-row__second_column\b/),
      descriptionHtml: element(html, 'class', /\bdescription\b/),
      ...sitePhotos(galleryOr(imageCandidates(gallery), html), {
        cdn: /(^|\.)(staticmorizon\.com\.pl|morizon\.pl)$/i,
      }),
    })
  },
}
