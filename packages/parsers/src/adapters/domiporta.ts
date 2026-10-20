import type { SiteAdapter } from '../types.ts'
import { element, elementText, h1, imageCandidates } from '../html.ts'
import { galleryOr, portalResult, sitePhotos } from '../portal.ts'

/**
 * domiporta.pl: schema.org microdata on the ad (name, price, geo, images), then
 * the "features" label/value list, the summary price and the location line.
 */
export const domiportaAdapter: SiteAdapter = {
  name: 'domiporta',
  matches: (url) => /(^|\.)domiporta\.pl$/i.test(url.hostname),
  parse(html, url) {
    const gallery = element(html, 'class', /\bgallery\b/) ?? ''
    return portalResult(url, html, 'domiporta', {
      details: element(html, 'class', /\bfeatures\b/),
      title: h1(html),
      price: elementText(html, 'class', /\bsummary__price\b/),
      location: elementText(html, 'class', /\bsummary__location\b/),
      descriptionHtml: element(html, 'class', /\bdescription__text\b/),
      ...sitePhotos(galleryOr(imageCandidates(gallery), html), {
        cdn: /(^|\.)domiporta\.pl$/i,
      }),
    })
  },
}
