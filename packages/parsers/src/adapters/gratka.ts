import type { SiteAdapter } from '../types.ts'
import { element, elementText, h1, imageCandidates } from '../html.ts'
import { portalResult, sitePhotos } from '../portal.ts'
import { imageUrls, jsonLdListing } from './generic.ts'

// Gratka image files end in a size suffix: …/38123456_916234567_mieszkanie-warszawa_xlarge.jpg
const SIZE = /_(thumb|small|medium|large|xlarge|xxlarge)\.(jpe?g|webp|png)$/i
const sized = (url: string, size: string) => url.replace(SIZE, `_${size}.$2`)

/**
 * gratka.pl: JSON-LD Product (name, price, images), then the "parameters" list
 * of label/value pairs and the sticker header (title, location, price).
 */
export const gratkaAdapter: SiteAdapter = {
  name: 'gratka',
  matches: (url) => /(^|\.)gratka\.pl$/i.test(url.hostname),
  parse(html, url) {
    const adId = url.pathname.match(/\/ob\/(\d+)/)?.[1]
    const gallery = element(html, 'class', /\bgallery\b/) ?? ''
    return portalResult(url, html, 'gratka', {
      details: element(html, 'class', /\bparameters\b/),
      title: elementText(html, 'class', /\bsticker__title\b/) ?? h1(html),
      price: elementText(html, 'class', /\bpriceInfo__value\b/),
      location: elementText(html, 'class', /\bsticker__location\b/),
      descriptionHtml: element(html, 'class', /\bdescription\b/),
      ...sitePhotos(
        [...imageUrls(jsonLdListing(html).pick('image')), ...imageCandidates(gallery)],
        {
          cdn: /(^|\.)(cppl\.pl|cdngr\.pl|gratka\.pl)$/i,
          medium: (u) => sized(u, 'large'),
          thumb: (u) => sized(u, 'medium'),
          belongs: adId ? (u) => u.includes(`/${adId}_`) : undefined,
        },
      ),
    })
  },
}
