/** Whether a lower or a higher number wins a compare row. */
export type Better = 'min' | 'max'

export const MAX_COMPARE = 4

/**
 * Columns holding the best value of a row. Nothing is highlighted when fewer
 * than two values are known or every known value ties.
 */
export function bestIndexes(values: (number | null | undefined)[], better: Better): number[] {
  const known = values.flatMap((v, i) => (v == null || !Number.isFinite(v) ? [] : [{ v, i }]))
  if (known.length < 2) return []
  const target =
    better === 'min' ? Math.min(...known.map((k) => k.v)) : Math.max(...known.map((k) => k.v))
  const best = known.filter((k) => k.v === target).map((k) => k.i)
  return best.length === known.length ? [] : best
}

/** `?ids=a,b,c` → up to four distinct ids, in order. */
export function parseCompareIds(raw: unknown): string[] {
  const value = Array.isArray(raw) ? raw.join(',') : typeof raw === 'string' ? raw : ''
  const ids = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set(ids)].slice(0, MAX_COMPARE)
}
