-- Milestone 2: ingest support.

-- Per-domain fetch throttle shared by every edge function instance.
create table public.domain_fetch_slots (
  domain text primary key,
  next_slot_at timestamptz not null default now()
);
alter table public.domain_fetch_slots enable row level security;
revoke all on public.domain_fetch_slots from anon, authenticated;

-- Reserves the next fetch slot for a domain and returns how many milliseconds
-- the caller must wait before fetching. Slots are spaced p_interval_ms apart.
create function public.claim_fetch_slot(p_domain text, p_interval_ms int default 3000)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_slot timestamptz;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.domain_fetch_slots as s (domain, next_slot_at)
  values (lower(p_domain), now() + make_interval(secs => p_interval_ms / 1000.0))
  on conflict (domain) do update
    set next_slot_at = greatest(s.next_slot_at, now()) + make_interval(secs => p_interval_ms / 1000.0)
  returning next_slot_at - make_interval(secs => p_interval_ms / 1000.0) into v_slot;

  return greatest(0, ceil(extract(epoch from (v_slot - now())) * 1000))::int;
end;
$$;

revoke execute on function public.claim_fetch_slot(text, int) from public, anon;
grant execute on function public.claim_fetch_slot(text, int) to authenticated, service_role;

-- Other listings in the same hunt that look like the same flat: price within 2%,
-- area within 1 m², same district. Runs as the caller, so RLS applies.
create function public.listing_possible_duplicates(p_listing_id uuid)
returns table (id uuid, title text, url text, rent numeric, area_m2 numeric, district text)
language sql stable security invoker set search_path = ''
as $$
  select o.id, o.title, o.url, o.rent, o.area_m2, o.district
  from public.listings l
  join public.listings o
    on o.hunt_id = l.hunt_id
   and o.id <> l.id
   and abs(o.rent - l.rent) <= l.rent * 0.02
   and abs(o.area_m2 - l.area_m2) <= 1
   and lower(trim(o.district)) = lower(trim(l.district))
  where l.id = p_listing_id
  order by o.created_at desc
  limit 5;
$$;

grant execute on function public.listing_possible_duplicates(uuid) to authenticated;
