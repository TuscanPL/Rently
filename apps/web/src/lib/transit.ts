import { decodePolyline } from '@at/shared'
import type { Tables } from './supabase'

export type ListingRoute = Tables<'listing_routes'>

export interface RouteLeg {
  mode: string
  line: string | null
  from: string | null
  to: string | null
  minutes: number
  fromLat?: number | null
  fromLng?: number | null
  toLat?: number | null
  toLng?: number | null
  path?: { points: string; precision: number } | null
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

/** Line colours on the map, by Transitous mode. Walking is drawn dashed in grey. */
export const MODE_COLORS: Record<string, string> = {
  WALK: '#475569',
  BUS: '#2563eb',
  COACH: '#2563eb',
  TRAM: '#dc2626',
  SUBWAY: '#7c3aed',
  METRO: '#7c3aed',
  RAIL: '#059669',
  REGIONAL_RAIL: '#059669',
  REGIONAL_FAST_RAIL: '#059669',
  SUBURBAN: '#059669',
}
const OTHER_COLOR = '#0f766e'

export interface RouteSegment {
  mode: string
  color: string
  dashed: boolean
  points: [number, number][]
}

type Point = { lat: number; lng: number }

/**
 * A stored trip as lines to draw: each leg's own shape when it has one, else a
 * straight line between its stops. The trip's ends fall back to the listing and
 * the pin when the planner left a leg's coordinates out.
 */
export function routeSegments(route: ListingRoute, from: Point, to: Point): RouteSegment[] {
  const legs = routeLegs(route)
  return legs
    .map((leg, i) => {
      let points: [number, number][] = leg.path
        ? decodePolyline(leg.path.points, leg.path.precision)
        : []
      if (points.length < 2) {
        const start =
          leg.fromLat != null && leg.fromLng != null
            ? { lat: leg.fromLat, lng: leg.fromLng }
            : i === 0
              ? from
              : null
        const end =
          leg.toLat != null && leg.toLng != null
            ? { lat: leg.toLat, lng: leg.toLng }
            : i === legs.length - 1
              ? to
              : null
        points =
          start && end
            ? [
                [start.lat, start.lng],
                [end.lat, end.lng],
              ]
            : []
      }
      return {
        mode: leg.mode,
        color: MODE_COLORS[leg.mode] ?? OTHER_COLOR,
        dashed: leg.mode === 'WALK',
        points,
      }
    })
    .filter((s) => s.points.length >= 2)
}
