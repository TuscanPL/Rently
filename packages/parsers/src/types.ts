import type { ParsedListing } from '@at/shared'

export interface ParseResult {
  listing: ParsedListing
  /** 0..1, how much of the important data the adapter found. */
  confidence: number
  /** Important fields the adapter could not fill. */
  missingFields: (keyof ParsedListing)[]
}

/**
 * A site adapter. Adapters work on an HTML string so the same code runs in the
 * edge function (fetched HTML) and the extension (document.documentElement.outerHTML).
 * They must never throw on unexpected markup: return what was found instead.
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
