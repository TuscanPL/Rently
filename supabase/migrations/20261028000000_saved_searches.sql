-- Saved Otodom searches and what they returned. A search is read only when a
-- member asks — pull to refresh reads page 1, scrolling to the end reads the
-- next page — never on a schedule. The search-refresh edge function stores the
-- light result cards here.

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references public.hunts (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 80),
  url text not null check (url ~* '^https://(www\.)?otodom\.pl/(pl|en)/wyniki/'),
  -- The filters, when the search was built in the app (null for a pasted link).
  params jsonb,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Written by the edge function.
  first_refreshed_at timestamptz,
  last_refreshed_at timestamptz,
  last_total int,
  last_error text,
  -- Result pages read since the last refresh, and how many Otodom has.
  loaded_pages int not null default 0,
  total_pages int
);
create index saved_searches_hunt_idx on public.saved_searches (hunt_id);

create table public.search_results (
  search_id uuid not null references public.saved_searches (id) on delete cascade,
  external_id text not null,
  hunt_id uuid not null references public.hunts (id) on delete cascade,
  url text not null,
  title text,
  rent numeric(10, 2),
  admin_fee numeric(10, 2),
  area_m2 numeric(7, 2),
  rooms int,
  floor int,
  district text,
  address text,
  private_owner boolean,
  photos text[] not null default '{}',
  posted_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Hidden for the whole hunt ("not interested").
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id) on delete set null,
  primary key (search_id, external_id)
);
create index search_results_hunt_idx on public.search_results (hunt_id, last_seen_at desc);

alter table public.saved_searches enable row level security;
alter table public.search_results enable row level security;

create policy saved_searches_select on public.saved_searches for select to authenticated
  using (public.is_hunt_member(hunt_id));
create policy saved_searches_insert on public.saved_searches for insert to authenticated
  with check (public.is_hunt_member(hunt_id) and created_by = auth.uid());
create policy saved_searches_update on public.saved_searches for update to authenticated
  using (public.is_hunt_member(hunt_id)) with check (public.is_hunt_member(hunt_id));
create policy saved_searches_delete on public.saved_searches for delete to authenticated
  using (public.is_hunt_member(hunt_id));
-- Members edit the label and URL; refresh bookkeeping is the function's.
revoke update on public.saved_searches from authenticated;
grant update (label, url, params) on public.saved_searches to authenticated;

create policy search_results_select on public.search_results for select to authenticated
  using (public.is_hunt_member(hunt_id));
create policy search_results_update on public.search_results for update to authenticated
  using (public.is_hunt_member(hunt_id)) with check (public.is_hunt_member(hunt_id));
-- Members can only hide or unhide; the cards themselves come from the function.
revoke insert, update, delete on public.search_results from anon, authenticated;
grant update (hidden_at, hidden_by) on public.search_results to authenticated;

-- A changed URL is a different search: forget what the old one returned.
create function public.reset_changed_search()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.search_results where search_id = new.id;
  new.first_refreshed_at := null;
  new.last_refreshed_at := null;
  new.last_total := null;
  new.last_error := null;
  new.loaded_pages := 0;
  new.total_pages := null;
  return new;
end;
$$;

create trigger saved_searches_reset
  before update of url on public.saved_searches
  for each row when (old.url is distinct from new.url)
  execute function public.reset_changed_search();

revoke execute on function public.reset_changed_search() from public, anon, authenticated;

alter publication supabase_realtime add table public.search_results;
