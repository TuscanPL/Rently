import { useI18n } from 'vue-i18n'
import { geocodeQuery } from '@at/shared'
import { buildIcs, downloadIcs } from './ics'
import type { Listing } from './listings'

/** Where a listing lives in the app, e.g. https://me.github.io/repo/#/h/<hunt>/l/<id>. */
export function listingAppUrl(l: Pick<Listing, 'hunt_id' | 'id'>): string {
  return new URL(
    `${import.meta.env.BASE_URL}#/h/${l.hunt_id}/l/${l.id}`,
    window.location.origin,
  ).toString()
}

/** Returns a function that downloads a listing's booked viewing as an .ics file. */
export function useViewingIcs() {
  const { t } = useI18n()
  return (l: Listing) => {
    if (!l.viewing_at) return
    const url = listingAppUrl(l)
    const ics = buildIcs({
      // Stable per listing: importing again after a reschedule updates the entry.
      uid: `viewing-${l.id}@apartment-together`,
      start: new Date(l.viewing_at),
      summary: t('pipeline.icsSummary', { title: l.title ?? t('listing.untitled') }),
      location: geocodeQuery(l.address, l.district) || null,
      url,
      description: t('pipeline.icsDescription', { url }),
    })
    downloadIcs(`viewing-${l.id.slice(0, 8)}.ics`, ics)
  }
}
