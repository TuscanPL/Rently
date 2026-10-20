import { parsedListingSchema, type ParsedListing } from '@at/shared'
import { IMPORTANT_FIELDS, type ParseResult } from './types.ts'
import { extractFromText } from './text.ts'
import { sourceForUrl } from './url.ts'

type Draft = { [K in keyof ParsedListing]?: ParsedListing[K] | null | undefined }

const shape = parsedListingSchema.shape
const MAX_RAW_BYTES = 40_000

/** Keeps only fields that validate on their own, so one odd value never sinks the rest. */
export function sanitize(draft: Draft): Partial<ParsedListing> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(draft)) {
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue
    const field = shape[key as keyof typeof shape]
    if (!field) continue
    if (key === 'features') {
      const features = sanitizeFeatures(value as Record<string, unknown>)
      if (features) out.features = features
      continue
    }
    if (key === 'photos') {
      const photos = (value as unknown[]).filter(
        (p) => typeof p === 'string' && /^https?:\/\//.test(p),
      )
      if (photos.length) out.photos = [...new Set(photos)]
      continue
    }
    const parsed = field.safeParse(typeof value === 'string' ? value.trim() : value)
    if (parsed.success) out[key] = parsed.data
  }
  return out as Partial<ParsedListing>
}

function sanitizeFeatures(features: Record<string, unknown>) {
  const fshape = shape.features.unwrap().shape
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(features)) {
    const field = fshape[key as keyof typeof fshape]
    if (value == null || !field) continue
    const parsed = field.safeParse(value)
    if (parsed.success) out[key] = parsed.data
  }
  return Object.keys(out).length ? out : undefined
}

function trimRaw(raw: unknown): unknown {
  if (raw == null) return undefined
  try {
    const json = JSON.stringify(raw)
    return json.length <= MAX_RAW_BYTES ? JSON.parse(json) : { truncated: true, bytes: json.length }
  } catch {
    return undefined
  }
}

/**
 * Builds a ParseResult from what an adapter found. Fields missing from the
 * structured data are filled from the description text where the regex
 * heuristics are confident.
 */
export function buildResult(url: URL, draft: Draft, raw?: unknown): ParseResult {
  const found = sanitize(draft)
  if (found.description) {
    const fromText = sanitize(extractFromText(found.description))
    delete fromText.title
    delete fromText.description
    for (const [key, value] of Object.entries(fromText) as [keyof ParsedListing, never][]) {
      if (key === 'features') {
        found.features = { ...(value as object), ...found.features }
      } else if (found[key] == null) {
        found[key] = value
      }
    }
  }
  const listing: ParsedListing = {
    ...found,
    source: found.source ?? sourceForUrl(url),
    url: url.toString(),
  }
  const missingFields = IMPORTANT_FIELDS.filter((f) =>
    f === 'district' ? listing.district == null && listing.address == null : listing[f] == null,
  )
  return {
    listing,
    confidence: Math.round((1 - missingFields.length / IMPORTANT_FIELDS.length) * 100) / 100,
    missingFields,
    raw: trimRaw(raw),
  }
}

/** Fields from `primary` win; `secondary` fills the gaps. */
export function mergeResults(url: URL, primary: ParseResult, secondary: ParseResult): ParseResult {
  const merged: Draft = { ...secondary.listing }
  for (const [key, value] of Object.entries(primary.listing)) {
    if (value != null) (merged as Record<string, unknown>)[key] = value
  }
  merged.features = { ...secondary.listing.features, ...primary.listing.features }
  return buildResult(url, merged, primary.raw ?? secondary.raw)
}
