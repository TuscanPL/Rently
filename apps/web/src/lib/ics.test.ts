import { describe, expect, it } from 'vitest'
import { buildIcs, escapeText, foldLine, icsLocalTime } from './ics'
import { fromWarsawInput, toWarsawInput } from './time'

const utf8Length = (s: string) => new TextEncoder().encode(s).length

describe('Warsaw time', () => {
  it('reads datetime-local values as Warsaw time, winter and summer', () => {
    expect(fromWarsawInput('2026-11-12T18:00')?.toISOString()).toBe('2026-11-12T17:00:00.000Z')
    expect(fromWarsawInput('2026-07-01T09:30')?.toISOString()).toBe('2026-07-01T07:30:00.000Z')
  })
  it('round-trips through the input format', () => {
    const d = new Date('2026-03-29T08:15:00Z') // the day CEST starts
    expect(toWarsawInput(d)).toBe('2026-03-29T10:15')
    expect(fromWarsawInput(toWarsawInput(d))?.toISOString()).toBe(d.toISOString())
  })
  it('rejects garbage', () => {
    expect(fromWarsawInput('')).toBeNull()
    expect(fromWarsawInput('tomorrow')).toBeNull()
  })
})

describe('escapeText', () => {
  it('escapes backslashes, separators and line breaks', () => {
    expect(escapeText('a\\b; c, d\nnext\r\nlast')).toBe('a\\\\b\\; c\\, d\\nnext\\nlast')
  })
})

describe('foldLine', () => {
  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short')
  })
  it('folds at 75 octets without splitting UTF-8 characters', () => {
    const line = `DESCRIPTION:${'żółć '.repeat(40)}`
    const parts = foldLine(line).split('\r\n')
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect(utf8Length(p)).toBeLessThanOrEqual(75)
    for (const p of parts.slice(1)) expect(p.startsWith(' ')).toBe(true)
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line)
  })
})

describe('buildIcs', () => {
  const ics = buildIcs({
    uid: 'viewing-123@apartment-together',
    start: new Date('2026-11-12T17:00:00Z'),
    summary: 'Viewing: 3 pokoje, Mokotów; balkon',
    location: 'Puławska 145, Warszawa',
    url: 'https://example.github.io/app/#/h/1/l/123',
    description: 'Open in ApartmentTogether:\nhttps://example.github.io/app/#/h/1/l/123',
    now: new Date('2026-10-19T08:15:30.123Z'),
  })
  const lines = ics.split('\r\n')

  it('is a CRLF calendar with one event', () => {
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(lines).toContain('VERSION:2.0')
  })
  it('uses Warsaw local times with a VTIMEZONE', () => {
    expect(lines).toContain('BEGIN:VTIMEZONE')
    expect(lines).toContain('TZID:Europe/Warsaw')
    expect(lines).toContain('DTSTART;TZID=Europe/Warsaw:20261112T180000')
    expect(lines).toContain('DTEND;TZID=Europe/Warsaw:20261112T190000')
    expect(lines).toContain('DTSTAMP:20261019T081530Z')
  })
  it('escapes text but not the URL', () => {
    expect(lines).toContain('SUMMARY:Viewing: 3 pokoje\\, Mokotów\\; balkon')
    expect(lines).toContain('LOCATION:Puławska 145\\, Warszawa')
    expect(lines).toContain('URL:https://example.github.io/app/#/h/1/l/123')
    expect(ics).toContain('DESCRIPTION:Open in ApartmentTogether:\\nhttps://')
  })
  it('keeps every line within 75 octets', () => {
    for (const l of lines) expect(utf8Length(l)).toBeLessThanOrEqual(75)
  })
  it('handles DST in the end time', () => {
    // The night clocks go back (03:00 CEST → 02:00 CET at 01:00 UTC): end times
    // come from the real instant, not from adding an hour to the wall time.
    expect(icsLocalTime(new Date('2026-10-24T23:30:00Z'))).toBe('20261025T013000')
    const late = buildIcs({ uid: 'x', start: new Date('2026-10-24T23:30:00Z'), summary: 'x' })
    expect(late).toContain('DTEND;TZID=Europe/Warsaw:20261025T023000')
  })
  it('skips empty optional fields', () => {
    const bare = buildIcs({ uid: 'x', start: new Date('2026-11-12T17:00:00Z'), summary: 'x' })
    expect(bare).not.toContain('LOCATION')
    expect(bare).not.toContain('URL')
  })
})
