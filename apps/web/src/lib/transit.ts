import type { Tables } from './supabase'

export type ListingRoute = Tables<'listing_routes'>

export interface RouteLeg {
  mode: string
  line: string | null
  from: string | null
  to: string | null
  minutes: number
}

export const routeKey = (listingId: string, pinId: string) => `${listingId}:${pinId}`

/** Transitous mode names → an icon. Anything unknown counts as generic transit. */
export const MODE_ICONS: Record<string, string> = {
  WALK: '🚶',
  BUS: '🚌',
  COACH: '🚌',
  TRAM: '🚋',
  SUBWAY: '🚇',
  METRO: '🚇',
  RAIL: '🚆',
  REGIONAL_RAIL: '🚆',
  REGIONAL_FAST_RAIL: '🚆',
  SUBURBAN: '🚆',
  HIGHSPEED_RAIL: '🚄',
  LONG_DISTANCE: '🚄',
  FERRY: '⛴️',
}

export const modeIcon = (mode: string) => MODE_ICONS[mode] ?? '🚍'

export function routeLegs(route: ListingRoute): RouteLeg[] {
  return Array.isArray(route.legs) ? (route.legs as unknown as RouteLeg[]) : []
}

/** "🚶 5 · 🚋 17 · 🚇 M1 · 🚶 4": walks show minutes, rides show the line. */
export function legSummary(route: ListingRoute): string {
  return routeLegs(route)
    .filter((l) => l.mode !== 'WALK' || l.minutes > 0)
    .map((l) => `${modeIcon(l.mode)} ${l.mode === 'WALK' ? l.minutes : (l.line ?? l.minutes)}`)
    .join(' · ')
}

/** Short weekday + time a pin's trips arrive by, e.g. "Tue 09:00". */
export function arrivalLabel(weekday: number, time: string, locale = 'en-GB'): string {
  // 2024-01-01 was a Monday: weekday N is January N.
  const day = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(
    new Date(Date.UTC(2024, 0, weekday, 12)),
  )
  return `${day} ${time.slice(0, 5)}`
}
