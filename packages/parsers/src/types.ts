import type { ParsedListing } from '@at/shared'

export interface ParseResult {
  listing: ParsedListing
  /** 0..1, share of the important fields the adapter found. */
  confidence: number
  /** Important fields the adapter could not fill. */
  missingFields: ImportantField[]
  /** Trimmed source subtree, stored in listings.raw for debugging. */
  raw?: unknown
}

export const IMPORTANT_FIELDS = ['title', 'rent', 'areaM2', 'rooms', 'district', 'photos'] as const
export type ImportantField = (typeof IMPORTANT_FIELDS)[number]

/**
 * A site adapter. Adapters work on an HTML string so the same code runs in the
 * edge function (fetched HTML) and the extension (document.documentElement.outerHTML).
 * Throwing is allowed but discouraged: parseListingHtml catches it and falls back.
 */
export interface SiteAdapter {
  name: string
  matches(url: URL): boolean
  parse(html: string, url: URL): ParseResult
}

/**
 * Turns free text (e.g. a Facebook group post) into a partial listing.
 * v1 uses regex heuristics; an LLM-backed implementation can slot in later.
 */
export type TextExtractor = (text: string) => Partial<ParsedListing>
