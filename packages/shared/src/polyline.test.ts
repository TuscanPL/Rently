import { describe, expect, it } from 'vitest'
import { decodePolyline, encodePolyline } from './polyline.ts'

describe('polyline', () => {
  it("decodes Google's reference example", () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ])
  })

  it('round-trips Warsaw coordinates at precision 6 and 7', () => {
    const pts: [number, number][] = [
      [52.180812, 20.999734],
      [52.2297, 21.0122],
      [52.23, 21.011],
    ]
    for (const p of [6, 7]) {
      const back = decodePolyline(encodePolyline(pts, p), p)
      back.forEach(([lat, lng], i) => {
        expect(lat).toBeCloseTo(pts[i]![0], 6)
        expect(lng).toBeCloseTo(pts[i]![1], 6)
      })
    }
  })

  it('stops at a truncated string instead of throwing', () => {
    expect(decodePolyline('_p~iF~ps|U_ulL')).toEqual([[38.5, -120.2]])
  })
})
