import { describe, expect, it } from 'vitest'
import { encodePolyline } from '@at/shared'
import { legSummary, routeSegments, type ListingRoute } from './transit'

const route = (legs: unknown[]) => ({ legs }) as unknown as ListingRoute
const listing = { lat: 52.18, lng: 21.0 }
const pin = { lat: 52.23, lng: 21.01 }

describe('routeSegments', () => {
  it('draws shapes where legs have them and straight lines between stops otherwise', () => {
    const shape: [number, number][] = [
      [52.181, 21.001],
      [52.19, 21.005],
      [52.2, 21.006],
    ]
    const segments = routeSegments(
      route([
        { mode: 'WALK', minutes: 5, toLat: 52.181, toLng: 21.001 },
        {
          mode: 'TRAM',
          line: '17',
          minutes: 15,
          path: { points: encodePolyline(shape, 6), precision: 6 },
        },
        { mode: 'WALK', minutes: 4, fromLat: 52.2, fromLng: 21.006 },
      ]),
      listing,
      pin,
    )
    expect(segments.map((s) => [s.mode, s.dashed, s.points.length])).toEqual([
      ['WALK', true, 2],
      ['TRAM', false, 3],
      ['WALK', true, 2],
    ])
    // The first walk starts at the listing, the last ends at the pin.
    expect(segments[0]!.points[0]).toEqual([52.18, 21.0])
    expect(segments[2]!.points[1]).toEqual([52.23, 21.01])
    expect(segments[1]!.color).toBe('#dc2626')
  })

  it('skips a middle leg it has no coordinates for', () => {
    const segments = routeSegments(
      route([
        { mode: 'BUS', minutes: 3, toLat: 52.19, toLng: 21.0 },
        { mode: 'WALK', minutes: 2 },
        { mode: 'BUS', minutes: 3, fromLat: 52.2, fromLng: 21.0 },
      ]),
      listing,
      pin,
    )
    expect(segments.map((s) => s.points)).toEqual([
      [
        [52.18, 21.0],
        [52.19, 21.0],
      ],
      [
        [52.2, 21.0],
        [52.23, 21.01],
      ],
    ])
  })
})

describe('legSummary', () => {
  it('shows minutes for walks and lines for rides', () => {
    expect(
      legSummary(
        route([
          { mode: 'WALK', minutes: 5 },
          { mode: 'TRAM', line: '17', minutes: 15 },
          { mode: 'WALK', minutes: 0 },
        ]),
      ),
    ).toBe('🚶 5 · 🚋 17')
  })
})
