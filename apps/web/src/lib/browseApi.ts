import type { ParsedListing } from '@at/shared'
import type { SearchResult } from './browse'
import { supabase } from './supabase'

/** Reads the full ad behind a result (once; search-refresh keeps it for everyone). */
export async function loadResultDetail(
  r: Pick<SearchResult, 'search_id' | 'external_id'>,
): Promise<ParsedListing> {
  const { data, error } = await supabase.functions.invoke<{ detail: ParsedListing }>(
    'search-refresh',
    { body: { searchId: r.search_id, externalId: r.external_id } },
  )
  if (error || !data) {
    const ctx = (error as { context?: Response } | null)?.context
    const body = ctx && (await ctx.json().catch(() => null))
    throw new Error(body?.error ?? error?.message ?? 'Could not load the ad')
  }
  return data.detail
}
