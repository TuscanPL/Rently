import { distanceBetween, type MaybeLatLng, type PinKind, type Swipe } from '@at/shared'
import { supabase, type Tables } from './supabase'

export type Pin = Tables<'pins'>

/** Central Warsaw: where the map opens when there's nothing to show yet. */
export const DEFAULT_CENTER = { lat: 52.2297, lng: 21.0122 }

export const PIN_ICONS: Record<PinKind, string> = {
  work: '💼',
  station: '🚉',
  family: '👪',
  other: '📍',
}

export type GeocodeResponse =
  | { found: true; cached: boolean; lat: number; lng: number; displayName: string }
  | { found: false; cached: boolean }

/** Address → coordinates through the `geocode` edge function (Nominatim, cached). */
export async function geocode(q: string, city?: string | null): Promise<GeocodeResponse> {
  const { data, error } = await supabase.functions.invoke<GeocodeResponse>('geocode', {
    body: { q, city: city ?? undefined },
  })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const detail = ctx && (await ctx.json().catch(() => null))
    throw new Error(detail?.error ?? error.message)
  }
  return data!
}

export interface PinDistance {
  pin: Pin
  km: number
}

/** Distance from a place to every pin, nearest first. Empty when the place has no coordinates. */
export function pinDistances(place: MaybeLatLng | null | undefined, pins: Pin[]): PinDistance[] {
  return pins
    .map((pin) => ({ pin, km: distanceBetween(place, pin) }))
    .filter((d): d is PinDistance => d.km != null)
    .sort((a, b) => a.km - b.km)
}

/**
 * What a listing marker on the map shows about the vote. Milestone 3 adds the
 * hunt-wide summary (e.g. `isMatch`) here; `markerColor` is the one place that
 * turns it into a colour.
 */
export interface MarkerVoteState {
  myVote: Swipe | null
  isMatch: boolean
}

export type MarkerTone = 'match' | 'yes' | 'maybe' | 'no' | 'unvoted'

export const MARKER_COLORS: Record<MarkerTone, string> = {
  match: '#7c3aed', // violet-600
  yes: '#059669', // emerald-600
  maybe: '#d97706', // amber-600
  no: '#e11d48', // rose-600
  unvoted: '#64748b', // slate-500
}

export function markerTone(state: MarkerVoteState): MarkerTone {
  if (state.isMatch) return 'match'
  return state.myVote ?? 'unvoted'
}

export function markerColor(state: MarkerVoteState): string {
  return MARKER_COLORS[markerTone(state)]
}
