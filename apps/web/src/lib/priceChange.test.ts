import { describe, expect, it } from 'vitest'
import { latestPriceChange } from './priceChange'

const now = new Date('2026-10-19T12:00:00Z')
const point = (rent: number | null, admin_fee: number | null, observed_at: string) => ({
  rent,
  admin_fee,
  observed_at,
})

describe('latestPriceChange', () => {
  it('compares the newest entry with the one before', () => {
    expect(
      latestPriceChange(
        [
          point(4500, 700, '2026-10-18T04:00:00Z'),
          point(4300, 700, '2026-10-19T04:00:00Z'),
          point(4600, 700, '2026-09-01T04:00:00Z'),
        ],
        now,
      ),
    ).toEqual({ delta: -200, at: '2026-10-19T04:00:00Z' })
  })
  it('adds up rent and admin fee changes', () => {
    expect(
      latestPriceChange(
        [point(4000, 600, '2026-10-10T04:00:00Z'), point(4100, 650, '2026-10-19T04:00:00Z')],
        now,
      )?.delta,
    ).toBe(150)
  })
  it('ignores an admin fee known on one side only', () => {
    expect(
      latestPriceChange(
        [point(4000, null, '2026-10-10T04:00:00Z'), point(3900, 650, '2026-10-19T04:00:00Z')],
        now,
      )?.delta,
    ).toBe(-100)
  })
  it('shows nothing for one entry, no change or an old change', () => {
    expect(latestPriceChange([point(4000, 600, '2026-10-19T04:00:00Z')], now)).toBeNull()
    expect(
      latestPriceChange(
        [point(4000, 600, '2026-10-10T04:00:00Z'), point(4000, 600, '2026-10-19T04:00:00Z')],
        now,
      ),
    ).toBeNull()
    expect(
      latestPriceChange(
        [point(4000, 600, '2026-09-01T04:00:00Z'), point(3800, 600, '2026-10-01T04:00:00Z')],
        now,
      ),
    ).toBeNull()
  })
})
