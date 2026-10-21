-- Public transport trips from each listing to each of the hunt's pins.
-- A trip is looked up once (Transitous, via the transit-routes edge function)
-- and kept: timetables barely change during a hunt. It is dropped, and looked up
-- again, only when the listing or the pin moves or the pin's arrival time changes.

-- When the trip should get you to the pin: a weekday (ISO, 1 = Monday) and a
-- Warsaw-time clock time, e.g. work Tuesday 9:00, family Saturday 12:00.
alter table public.pins
  add column arrive_weekday smallint not null default 2 check (arrive_weekday between 1 and 7),
  add column arrive_time time not null default '09:00';

create table public.listing_routes (
  listing_id uuid not null references public.listings (id) on delete cascade,
  pin_id uuid not null references public.pins (id) on delete cascade,
  -- ok: a trip was found; no_route: the planner found nothing; error: the
  -- planner failed (retried after a while, see the edge function).
  status text not null check (status in ('ok', 'no_route', 'error')),
  duration_min int,
  transfers int,
  walk_min int,
  -- [{ mode, line, from, to, minutes }], walking legs included.
  legs jsonb not null default '[]'::jsonb,
  departs_at timestamptz,
  arrives_at timestamptz,
  provider text not null default 'transitous',
  computed_at timestamptz not null default now(),
  primary key (listing_id, pin_id)
);
create index listing_routes_pin_idx on public.listing_routes (pin_id);

alter table public.listing_routes enable row level security;
-- Members read; only the edge function (service role) writes.
create policy listing_routes_select on public.listing_routes for select to authenticated
  using (public.is_listing_member(listing_id));
revoke insert, update, delete on public.listing_routes from anon, authenticated;

create function public.drop_routes_for_moved_listing()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.listing_routes where listing_id = new.id;
  return new;
end;
$$;

create trigger listings_drop_routes
  after update of lat, lng on public.listings
  for each row when (old.lat is distinct from new.lat or old.lng is distinct from new.lng)
  execute function public.drop_routes_for_moved_listing();

create function public.drop_routes_for_changed_pin()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.listing_routes where pin_id = new.id;
  return new;
end;
$$;

create trigger pins_drop_routes
  after update of lat, lng, arrive_weekday, arrive_time on public.pins
  for each row when (
    old.lat is distinct from new.lat or old.lng is distinct from new.lng
    or old.arrive_weekday is distinct from new.arrive_weekday
    or old.arrive_time is distinct from new.arrive_time
  )
  execute function public.drop_routes_for_changed_pin();

revoke execute on function
  public.drop_routes_for_moved_listing(),
  public.drop_routes_for_changed_pin()
from public, anon, authenticated;

alter publication supabase_realtime add table public.listing_routes;
