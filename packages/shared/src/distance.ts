export interface LatLng {
  lat: number
  lng: number
}

/** Something that may or may not have coordinates yet, like a listing row. */
export interface MaybeLatLng {
  lat?: number | null
  lng?: number | null
}

const EARTH_RADIUS_KM = 6371.0088

export function hasCoords<T extends MaybeLatLng>(p: T | null | undefined): p is T & LatLng {
  return p?.lat != null && p?.lng != null
}

/** Great-circle (haversine) distance in kilometres. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Distance between two places, or null when either has no coordinates. */
export function distanceBetween(
  a: MaybeLatLng | null | undefined,
  b: MaybeLatLng | null | undefined,
): number | null {
  return hasCoords(a) && hasCoords(b) ? distanceKm(a, b) : null
}

const oneDecimal = new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const whole = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0, useGrouping: 'always' })

/** Polish style: "850 m", "1,2 km", "14 km". Under 1 km rounds to 10 m. */
export function formatDistance(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) return '—'
  const metres = Math.round((km * 1000) / 10) * 10
  if (metres < 1000) return `${metres} m`
  if (km < 9.95) return `${oneDecimal.format(km)} km`
  return `${whole.format(Math.round(km))} km`
}

/**
 * Free-form geocoding query from address parts, e.g. "Puławska 145, Mokotów, Warszawa".
 * Skips blanks and parts the query already mentions ("…, Mokotów" + district "Mokotów").
 */
export function geocodeQuery(...parts: (string | null | undefined)[]): string {
  const out: string[] = []
  for (const raw of parts) {
    const part = raw?.trim().replace(/\s+/g, ' ')
    if (!part) continue
    if (out.join(', ').toLowerCase().includes(part.toLowerCase())) continue
    out.push(part)
  }
  return out.join(', ')
}
