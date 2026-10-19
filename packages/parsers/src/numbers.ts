/** Parses "3 500 zł", "3500,50", "52,5 m²", 3500 → number. Undefined when nothing numeric. */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string') return undefined
  const m = v.replace(/[\s ]/g, '').match(/-?\d+(?:[.,]\d+)?/)
  if (!m) return undefined
  const n = Number(m[0].replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

export function toInt(v: unknown): number | undefined {
  const n = toNumber(v)
  return n == null ? undefined : Math.round(n)
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

/** Rooms come as 3, "3", "three" (OLX), or "more" (treated as unknown). */
export function toRooms(v: unknown): number | undefined {
  if (typeof v === 'string' && WORD_NUMBERS[v.toLowerCase()]) return WORD_NUMBERS[v.toLowerCase()]
  const n = toInt(v)
  return n != null && n > 0 && n < 20 ? n : undefined
}

/** "floor_3" → 3, "ground_floor"/"parter" → 0, "cellar" → -1, "3" → 3. */
export function toFloor(v: unknown): number | undefined {
  if (typeof v === 'string') {
    const s = v.toLowerCase()
    if (/ground|parter/.test(s)) return 0
    if (/cellar|suterena|basement/.test(s)) return -1
    if (/garret|poddasze/.test(s)) return undefined
  }
  return toInt(v)
}

/** "2026-11-01", "2026-11-01T00:00:00Z", "01.11.2026" → "2026-11-01". */
export function toIsoDate(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/)
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
  return undefined
}
