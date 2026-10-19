import { WARSAW, warsawWallTime } from './time'

// A minimal iCalendar (RFC 5545) file for one viewing, built in the browser.

export interface IcsEvent {
  /** Stable id, so re-downloading after a reschedule updates the same calendar entry. */
  uid: string
  start: Date
  durationMinutes?: number
  summary: string
  location?: string | null
  url?: string | null
  description?: string | null
  /** DTSTAMP; defaults to now. */
  now?: Date
}

// Europe/Warsaw since 1996: CET in winter, CEST from the last Sunday of March
// to the last Sunday of October.
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${WARSAW}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
]

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** Warsaw local time as "20261112T180000". */
export function icsLocalTime(date: Date): string {
  const w = warsawWallTime(date)
  return `${pad(w.year, 4)}${pad(w.month)}${pad(w.day)}T${pad(w.hour)}${pad(w.minute)}${pad(w.second)}`
}

/** UTC as "20261019T081500Z". */
export function icsUtcTime(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/** Escapes a TEXT value: backslash, semicolon, comma and line breaks. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

const encoder = new TextEncoder()

/** Folds a content line at 75 octets, never inside a UTF-8 character. */
export function foldLine(line: string): string {
  const out: string[] = []
  let current = ''
  let size = 0
  for (const ch of line) {
    const bytes = encoder.encode(ch).length
    // Continuation lines start with a space, which counts towards their 75.
    const limit = out.length === 0 ? 75 : 74
    if (size + bytes > limit) {
      out.push(current)
      current = ''
      size = 0
    }
    current += ch
    size += bytes
  }
  out.push(current)
  return out.join('\r\n ')
}

export function buildIcs(e: IcsEvent): string {
  const end = new Date(e.start.getTime() + (e.durationMinutes ?? 60) * 60_000)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ApartmentTogether//Viewing//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...VTIMEZONE,
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${icsUtcTime(e.now ?? new Date())}`,
    `DTSTART;TZID=${WARSAW}:${icsLocalTime(e.start)}`,
    `DTEND;TZID=${WARSAW}:${icsLocalTime(end)}`,
    `SUMMARY:${escapeText(e.summary)}`,
  ]
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`)
  if (e.url) lines.push(`URL:${e.url}`)
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/** Hands the file to the browser as a download. */
export function downloadIcs(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
