import { describe, expect, it } from 'vitest'
import { bestIndexes, parseCompareIds } from './compare'

describe('bestIndexes', () => {
  it('picks the lowest or highest value', () => {
    expect(bestIndexes([4400, 3900, 5100], 'min')).toEqual([1])
    expect(bestIndexes([48, 62, 55], 'max')).toEqual([1])
  })
  it('highlights every column sharing the best value', () => {
    expect(bestIndexes([3, 3, 2], 'max')).toEqual([0, 1])
  })
  it('skips unknown values', () => {
    expect(bestIndexes([null, 4000, 4200], 'min')).toEqual([1])
  })
  it('highlights nothing when all known values tie or only one is known', () => {
    expect(bestIndexes([3, 3], 'max')).toEqual([])
    expect(bestIndexes([3, null, 3], 'max')).toEqual([])
    expect(bestIndexes([null, 4000], 'min')).toEqual([])
  })
})

describe('parseCompareIds', () => {
  it('splits, dedupes and caps at four', () => {
    expect(parseCompareIds('a, b,,a,c,d,e')).toEqual(['a', 'b', 'c', 'd'])
  })
  it('tolerates a missing or repeated query param', () => {
    expect(parseCompareIds(undefined)).toEqual([])
    expect(parseCompareIds(['a', 'b'])).toEqual(['a', 'b'])
  })
})
