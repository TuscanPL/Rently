import type { ParsedListing } from '@at/shared'
import type { TextExtractor } from './types.ts'
import { toNumber } from './numbers.ts'

// Regex heuristics for Polish rental posts. Each rule is deliberately narrow:
// a missed field is fine (the user fills it in), a wrong one is worse.

const AMOUNT = String.raw`(\d{1,3}(?:[  .]\d{3})+|\d+)(?:[.,]\d{1,2})?\s*(?:zł|zl|pln|złotych)`
const amountRe = (prefix: string, flags = 'i') =>
  new RegExp(`${prefix}[^\\d\\n]{0,40}?${AMOUNT}`, flags)

const ADMIN_FEE = amountRe(
  String.raw`(?:czynsz\s+(?:administracyjny|do\s+spółdzielni|do\s+wspólnoty|dla\s+spółdzielni|admin\.?)|opłaty?\s+administracyjn\w*|\+\s*czynsz|oraz\s+czynsz)`,
)
const UTILITIES = amountRe(String.raw`(?:media|rachunki|opłaty\s+za\s+media|prąd\s+i\s+gaz)`)
const DEPOSIT = amountRe(String.raw`(?:kaucj[aię]|kaucji|depozyt)`)
const RENT = amountRe(
  String.raw`(?:cena(?:\s+najmu)?|czynsz\s+najmu|najem|odstępne|wynajmę\s+za|wynajem\s+za|za\s+miesiąc|miesięcznie|koszt\s+najmu|opłata\s+za\s+najem)`,
)
const ANY_AMOUNT = new RegExp(AMOUNT, 'gi')

const AREA = /(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:m2|m²|m\s?kw\.?|mkw|metr(?:ów|y)?\s+kw\w*|metrów)/i
const ROOMS_NUM = /(\d)\s*[-‑ ]?\s*(?:pokoje|pokoi|pokój|pokojowe|pok\.)/i
const ROOMS_WORD: [RegExp, number][] = [
  [/kawalerk|jednopokojow|1-pokojow/i, 1],
  [/dwupokojow/i, 2],
  [/trzypokojow/i, 3],
  [/czteropokojow/i, 4],
  [/pięciopokojow/i, 5],
]
const FLOOR =
  /(?:(\d{1,2})\s*(?:\.|-?te|-?gie)?\s*piętr\w*|piętro\s*:?\s*(\d{1,2}))(?:\s*(?:\/|na|z)\s*(\d{1,2}))?/i
const GROUND_FLOOR = /\bparter\w*/i

function amount(text: string, re: RegExp): number | undefined {
  const m = text.match(re)
  return m ? toNumber(m[1]!.replace(/\./g, '')) : undefined
}

function floor(text: string): Pick<ParsedListing, 'floor' | 'totalFloors'> {
  const m = text.match(FLOOR)
  if (m) {
    const total = m[3] ? Number(m[3]) : undefined
    return { floor: Number(m[1] ?? m[2]), totalFloors: total }
  }
  if (GROUND_FLOOR.test(text)) return { floor: 0 }
  return {}
}

function rooms(text: string): number | undefined {
  const m = text.match(ROOMS_NUM)
  if (m) return Number(m[1])
  return ROOMS_WORD.find(([re]) => re.test(text))?.[1]
}

function yesNo(text: string, yes: RegExp, no: RegExp): boolean | undefined {
  if (no.test(text)) return false
  if (yes.test(text)) return true
  return undefined
}

export const extractFromText: TextExtractor = (text) => {
  const out: Partial<ParsedListing> = {}
  const adminFee = amount(text, ADMIN_FEE)
  const utilitiesEstimate = amount(text, UTILITIES)
  const deposit = amount(text, DEPOSIT)
  let rent = amount(text, RENT)

  // No labelled rent: take the first amount that isn't one of the other costs.
  if (rent == null) {
    const others = new Set([adminFee, utilitiesEstimate, deposit])
    for (const m of text.matchAll(ANY_AMOUNT)) {
      const n = toNumber(m[1]!.replace(/\./g, ''))
      if (n != null && n >= 500 && !others.has(n)) {
        rent = n
        break
      }
    }
  }

  if (rent != null) out.rent = rent
  if (adminFee != null) out.adminFee = adminFee
  if (utilitiesEstimate != null) out.utilitiesEstimate = utilitiesEstimate
  if (deposit != null) out.deposit = deposit

  const area = text.match(AREA)
  if (area) out.areaM2 = toNumber(area[1])
  const r = rooms(text)
  if (r != null) out.rooms = r
  Object.assign(out, floor(text))

  if (
    /bez\s+pośrednik|bezpośrednio\s+od\s+właściciel|prywatn\w+\s+(?:właściciel|ogłoszenie)|od\s+właściciela/i.test(
      text,
    )
  ) {
    out.advertiserType = 'private'
  } else if (/biuro\s+nieruchomości|agencj\w+|prowizj\w+|pośrednik\s+nieruchomości/i.test(text)) {
    out.advertiserType = 'agency'
  }

  const features: NonNullable<ParsedListing['features']> = {}
  const pets = yesNo(
    text,
    /zwierzęt\w*\s+(?:mile\s+widzian|akceptowan|dozwolon|ok)|akceptuj\w*\s+zwierz|pet\s*friendly/i,
    /bez\s+zwierząt|zwierzęta\s+nie|nie\s+akceptuj\w*\s+zwierz|zakaz\s+zwierząt/i,
  )
  if (pets != null) features.petsAllowed = pets
  if (/balkon|loggi|taras/i.test(text)) features.balcony = true
  if (/\bwind[aąy]\b/i.test(text)) features.elevator = true
  if (/miejsce\s+parkingowe|garaż|parking/i.test(text)) features.parking = true
  const furnished = yesNo(text, /umeblowan|w\s+pełni\s+wyposażon/i, /nieumeblowan|bez\s+mebli/i)
  if (furnished != null) features.furnished = furnished
  if (Object.keys(features).length > 0) out.features = features

  const firstLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length >= 8)
  if (firstLine) out.title = firstLine.slice(0, 120)
  out.description = text.trim()
  return out
}
