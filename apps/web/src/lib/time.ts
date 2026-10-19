// Viewing times are Warsaw wall-clock times, whatever time zone the browser is in.

export const WARSAW = 'Europe/Warsaw'

export interface WallTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: WARSAW,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** The date and time a Warsaw clock shows at this instant. */
export function warsawWallTime(date: Date): WallTime {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** "2026-11-12T18:00": the value of an <input type="datetime-local"> showing Warsaw time. */
export function toWarsawInput(date: Date): string {
  const w = warsawWallTime(date)
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`
}

/**
 * The instant a Warsaw clock reads `value` ("2026-11-12T18:00"). Null when it
 * doesn't parse. In the autumn DST overlap the earlier of the two instants wins.
 */
export function fromWarsawInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number]
  const wanted = Date.UTC(y, mo - 1, d, h, mi)
  // Start from the UTC reading and correct by Warsaw's offset (twice, for DST edges).
  let guess = wanted
  for (let i = 0; i < 2; i++) {
    const w = warsawWallTime(new Date(guess))
    const shown = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute)
    guess += wanted - shown
  }
  return Number.isNaN(guess) ? null : new Date(guess)
}
