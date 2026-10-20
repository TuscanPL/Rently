import { describe, expect, it } from 'vitest'
import { costPerM2, formatPLN, totalMonthly } from './cost.ts'

describe('totalMonthly', () => {
  it('sums rent, admin fee and utilities', () => {
    expect(totalMonthly({ rent: 3500, adminFee: 650, utilitiesEstimate: 300 })).toBe(4450)
  })
  it('treats missing extras as zero', () => {
    expect(totalMonthly({ rent: 3500 })).toBe(3500)
  })
  it('is null without rent', () => {
    expect(totalMonthly({ adminFee: 650 })).toBeNull()
  })
})

describe('costPerM2', () => {
  it('divides total by area', () => {
    expect(costPerM2({ rent: 4000, adminFee: 500, areaM2: 50 })).toBe(90)
  })
  it('is null without area', () => {
    expect(costPerM2({ rent: 4000 })).toBeNull()
  })
})

describe('formatPLN', () => {
  it('uses Polish formatting', () => {
    expect(formatPLN(4450).replace(/\s/g, ' ')).toBe('4 450 zł')
  })
  it('shows a dash for unknown', () => {
    expect(formatPLN(null)).toBe('—')
  })
})
