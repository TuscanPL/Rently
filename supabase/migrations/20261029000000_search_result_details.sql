-- The full ad behind a search result card, read from Otodom the first time a
-- member opens the card (search-refresh with an externalId) and kept so it's
-- read once. Adding the ad to the hunt reuses it instead of fetching again.

alter table public.search_results
  add column detail jsonb,
  add column detail_fetched_at timestamptz;
