-- Milestone 5: geocoding cache for the `geocode` edge function.

-- Nominatim answers keyed by the normalised query. A row with null lat/lng is a
-- cached miss, which expires sooner than a hit (the TTLs live in packages/edge).
-- Only the edge function's service-role client reads and writes it, so one hunt
-- can't plant coordinates that another hunt would get back.
create table public.geocode_cache (
  query text primary key check (length(query) between 1 and 300),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  display_name text,
  created_at timestamptz not null default now(),
  check ((lat is null) = (lng is null))
);
alter table public.geocode_cache enable row level security;
revoke all on public.geocode_cache from anon, authenticated;
