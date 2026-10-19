import { describe, expect, it } from 'vitest'
import { huntCriteriaSchema } from './schemas.ts'

describe('huntCriteriaSchema', () => {
  it('accepts the seed hunt criteria', () => {
    const seed = {
      minRooms: 3,
      privateOnly: true,
      maxDistanceKm: 1.5,
      distancePinId: '00000000-0000-4000-c000-000000000001',
      notes: 'Close to SKM Służewiec',
    }
    expect(huntCriteriaSchema.parse(seed)).toEqual(seed)
  })

  it('accepts no criteria at all', () => {
    expect(huntCriteriaSchema.parse({})).toEqual({})
  })

  it('rejects a window that ends before it starts', () => {
    const r = huntCriteriaSchema.safeParse({
      availableFrom: '2026-12-01',
      availableTo: '2026-11-01',
    })
    expect(r.success).toBe(false)
  })

  it('rejects nonsense numbers', () => {
    expect(huntCriteriaSchema.safeParse({ minRooms: 2.5 }).success).toBe(false)
    expect(huntCriteriaSchema.safeParse({ maxTotalMonthly: -1 }).success).toBe(false)
  })
})
