-- Milestone 8: upkeep (daily liveness/price re-checks and duplicate merge).
--
-- Event types written here (payload always carries hunt_id):
--   price_changed {rent_before, rent_after, admin_fee_before, admin_fee_after}  user_id null
--   ad_removed    {}                                                             user_id null
--   ad_restored   {}                                                             user_id null
--   merged        {kept_title, dropped_title, dropped_id}                        the merging member

-- Canonical URLs of listings merged into this one, so adding that ad again
-- finds the kept listing instead of creating a new copy.
alter table public.listings add column merged_urls text[] not null default '{}';

-- The re-check batch: oldest check first among listings with a URL.
create index listings_check_queue_idx
  on public.listings (last_checked_at nulls first)
  where url is not null and status not in ('won', 'rejected', 'gone');

-- ---------------------------------------------------------------------------
-- Liveness and price re-checks (service role only: called by refresh-listings)
-- ---------------------------------------------------------------------------
-- Listings due for a re-check, oldest check first (never checked first). Active
-- ads are re-checked after p_active_after; ads already marked removed less often,
-- after p_inactive_after, so one that comes back gets noticed. Listings the group
-- has finished with (won, rejected, gone) are left alone. total_due counts every
-- due listing, not just the returned page.
create function public.listings_due_for_check(
  p_limit int default 20,
  p_active_after interval default '20 hours',
  p_inactive_after interval default '7 days'
)
returns table (
  id uuid,
  hunt_id uuid,
  url text,
  rent numeric,
  is_active boolean,
  last_checked_at timestamptz,
  total_due bigint
)
language sql stable security definer set search_path = ''
as $$
  select l.id, l.hunt_id, l.url, l.rent, l.is_active, l.last_checked_at, count(*) over ()
  from public.listings l
  where l.url is not null
    and l.status not in ('won', 'rejected', 'gone')
    and (l.last_checked_at is null
         or l.last_checked_at < now() - case when l.is_active then p_active_after
                                             else p_inactive_after end)
  order by l.last_checked_at nulls first, l.created_at
  limit greatest(1, least(coalesce(p_limit, 20), 200));
$$;

-- Records the outcome of one re-check and logs what changed. p_result is
--   'gone'    the ad was taken down: mark inactive (the snapshot stays)
--   'alive'   the ad is up: reactivate if needed and compare prices
--   'unknown' the check was inconclusive: only bump last_checked_at
-- p_rent / p_admin_fee are the prices read from the live ad, or null when they
-- couldn't be read confidently; a null never overwrites a stored price.
-- Returns the event types written (empty when nothing changed).
create function public.record_listing_check(
  p_listing_id uuid,
  p_result text,
  p_rent numeric default null,
  p_admin_fee numeric default null
)
returns text[]
language plpgsql security definer set search_path = ''
as $$
declare
  v_l public.listings;
  v_events text[] := '{}';
  v_rent numeric;
  v_admin numeric;
begin
  if p_result not in ('gone', 'alive', 'unknown') then
    raise exception 'unknown check result %', p_result using errcode = '22023';
  end if;

  select * into v_l from public.listings where id = p_listing_id for update;
  if not found then
    return v_events;
  end if;

  if p_result = 'gone' then
    if v_l.is_active then
      update public.listings set is_active = false, last_checked_at = now()
      where id = p_listing_id;
      insert into public.listing_events (listing_id, user_id, type, payload)
      values (p_listing_id, null, 'ad_removed', jsonb_build_object('hunt_id', v_l.hunt_id));
      v_events := array_append(v_events, 'ad_removed');
    else
      update public.listings set last_checked_at = now() where id = p_listing_id;
    end if;
    return v_events;
  end if;

  if p_result = 'unknown' then
    update public.listings set last_checked_at = now() where id = p_listing_id;
    return v_events;
  end if;

  -- Alive.
  if not v_l.is_active then
    insert into public.listing_events (listing_id, user_id, type, payload)
    values (p_listing_id, null, 'ad_restored', jsonb_build_object('hunt_id', v_l.hunt_id));
    v_events := array_append(v_events, 'ad_restored');
  end if;

  v_rent := coalesce(p_rent, v_l.rent);
  v_admin := coalesce(p_admin_fee, v_l.admin_fee);

  -- A price that was missing is filled in quietly; only a known price that
  -- moved counts as a change.
  if (v_l.rent is not null and v_rent is distinct from v_l.rent)
     or (v_l.admin_fee is not null and v_admin is distinct from v_l.admin_fee) then
    -- Listings added before prices were tracked get their old price as the
    -- first history entry, so there is something to compare against.
    if not exists (select 1 from public.listing_price_history where listing_id = p_listing_id) then
      insert into public.listing_price_history (listing_id, rent, admin_fee, observed_at)
      values (p_listing_id, v_l.rent, v_l.admin_fee,
              least(coalesce(v_l.last_checked_at, v_l.created_at), now() - interval '1 second'));
    end if;
    insert into public.listing_price_history (listing_id, rent, admin_fee)
    values (p_listing_id, v_rent, v_admin);
    insert into public.listing_events (listing_id, user_id, type, payload)
    values (p_listing_id, null, 'price_changed',
            jsonb_build_object('hunt_id', v_l.hunt_id,
                               'rent_before', v_l.rent, 'rent_after', v_rent,
                               'admin_fee_before', v_l.admin_fee, 'admin_fee_after', v_admin));
    v_events := array_append(v_events, 'price_changed');
  elsif v_l.rent is null and v_rent is not null then
    insert into public.listing_price_history (listing_id, rent, admin_fee)
    values (p_listing_id, v_rent, v_admin);
  end if;

  update public.listings
  set is_active = true, last_checked_at = now(), rent = v_rent, admin_fee = v_admin
  where id = p_listing_id;
  return v_events;
end;
$$;

revoke execute on function
  public.listings_due_for_check(int, interval, interval),
  public.record_listing_check(uuid, text, numeric, numeric)
from public, anon, authenticated;
grant execute on function
  public.listings_due_for_check(int, interval, interval),
  public.record_listing_check(uuid, text, numeric, numeric)
to service_role;

-- ---------------------------------------------------------------------------
-- Duplicate merge
-- ---------------------------------------------------------------------------
-- Folds p_drop into p_keep (both in one hunt the caller belongs to), then deletes
-- p_drop. The kept listing's values always win; its empty fields are filled from
-- the dropped one and features are combined. Photos (appended after the kept
-- ones, one cover), comments, price history, events and reconsider requests move
-- over. Votes: each member keeps their vote on the kept listing; a vote only on
-- the dropped listing moves over. The dropped ad's URL is remembered in
-- merged_urls so adding it again finds the kept listing. Returns p_keep.
create function public.merge_listings(p_keep uuid, p_drop uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_k public.listings;
  v_d public.listings;
  v_take_url boolean;
  v_members int;
  v_yes_before int;
  v_yes_after int;
  v_offset int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_keep = p_drop then
    raise exception 'cannot merge a listing into itself' using errcode = '22023';
  end if;

  -- Lock in a fixed order so two merges of the same pair can't deadlock.
  perform 1 from public.listings where id in (p_keep, p_drop) order by id for update;
  select * into v_k from public.listings where id = p_keep;
  select * into v_d from public.listings where id = p_drop;
  if v_k.id is null or v_d.id is null
     or not public.is_hunt_member(v_k.hunt_id) or not public.is_hunt_member(v_d.hunt_id) then
    raise exception 'listing not found' using errcode = 'P0002';
  end if;
  if v_k.hunt_id <> v_d.hunt_id then
    raise exception 'listings are in different hunts' using errcode = '22023';
  end if;

  select count(*) into v_members from public.hunt_members where hunt_id = v_k.hunt_id;
  select count(*) into v_yes_before
  from public.votes v
  join public.hunt_members m on m.hunt_id = v_k.hunt_id and m.user_id = v.user_id
  where v.listing_id = p_keep and v.swipe = 'yes';

  -- Photos: after the kept ones; the dropped cover only stays a cover when the
  -- kept listing has none.
  select coalesce(max(position) + 1, 0) into v_offset
  from public.listing_photos where listing_id = p_keep;
  update public.listing_photos
  set listing_id = p_keep,
      position = position + v_offset,
      is_cover = is_cover and not exists (
        select 1 from public.listing_photos c where c.listing_id = p_keep and c.is_cover)
  where listing_id = p_drop;

  update public.comments set listing_id = p_keep where listing_id = p_drop;
  update public.listing_price_history set listing_id = p_keep where listing_id = p_drop;
  update public.listing_events set listing_id = p_keep where listing_id = p_drop;

  -- Votes: only members without a vote on the kept listing bring theirs along.
  -- The rest are deleted with the dropped listing.
  update public.votes v
  set listing_id = p_keep
  where v.listing_id = p_drop
    and not exists (select 1 from public.votes k
                    where k.listing_id = p_keep and k.user_id = v.user_id);

  -- Reconsider requests: an open request that duplicates one on the kept listing
  -- goes; one whose target already said something other than `no` on the kept
  -- listing is answered by that vote; the rest (and all answered ones) move over.
  delete from public.reconsider_requests r
  where r.listing_id = p_drop and r.resolved_at is null
    and exists (select 1 from public.reconsider_requests k
                where k.listing_id = p_keep and k.target_user = r.target_user
                  and k.resolved_at is null);
  update public.reconsider_requests r
  set resolved_at = now(), outcome = v.swipe
  from public.votes v
  where r.listing_id = p_drop and r.resolved_at is null
    and v.listing_id = p_keep and v.user_id = r.target_user and v.swipe <> 'no';
  update public.reconsider_requests set listing_id = p_keep where listing_id = p_drop;

  delete from public.listings where id = p_drop;

  v_take_url := v_k.url is null and v_d.url is not null;
  update public.listings set
    url = case when v_take_url then v_d.url else url end,
    canonical_url = case when v_take_url then v_d.canonical_url else canonical_url end,
    source = case when v_take_url then v_d.source else source end,
    title = coalesce(title, v_d.title),
    description = coalesce(description, v_d.description),
    rent = coalesce(rent, v_d.rent),
    admin_fee = coalesce(admin_fee, v_d.admin_fee),
    utilities_estimate = coalesce(utilities_estimate, v_d.utilities_estimate),
    deposit = coalesce(deposit, v_d.deposit),
    area_m2 = coalesce(area_m2, v_d.area_m2),
    rooms = coalesce(rooms, v_d.rooms),
    floor = coalesce(floor, v_d.floor),
    total_floors = coalesce(total_floors, v_d.total_floors),
    address = coalesce(address, v_d.address),
    district = coalesce(district, v_d.district),
    lat = case when lat is null or lng is null then v_d.lat else lat end,
    lng = case when lat is null or lng is null then v_d.lng else lng end,
    available_from = coalesce(available_from, v_d.available_from),
    advertiser_type = case when advertiser_type = 'unknown' then v_d.advertiser_type
                           else advertiser_type end,
    viewing_at = coalesce(viewing_at, v_d.viewing_at),
    raw = coalesce(raw, v_d.raw),
    features = coalesce(v_d.features, '{}'::jsonb) || coalesce(features, '{}'::jsonb),
    merged_urls = array(
      select u
      from unnest(merged_urls || v_d.merged_urls
                  || case when v_take_url then '{}'::text[] else array[v_d.canonical_url] end)
           with ordinality x(u, n)
      where u is not null and u is distinct from v_k.canonical_url
      group by u
      order by min(n)
    )
  where id = p_keep;

  update public.listings
  set needs_details = rent is null or area_m2 is null or rooms is null
  where id = p_keep and needs_details;

  insert into public.listing_events (listing_id, user_id, type, payload)
  values (p_keep, auth.uid(), 'merged',
          jsonb_build_object('hunt_id', v_k.hunt_id, 'kept_title', v_k.title,
                             'dropped_title', v_d.title, 'dropped_id', v_d.id));

  -- Votes that moved over can complete a match the vote trigger didn't see.
  select count(*) into v_yes_after
  from public.votes v
  join public.hunt_members m on m.hunt_id = v_k.hunt_id and m.user_id = v.user_id
  where v.listing_id = p_keep and v.swipe = 'yes';
  if v_members > 0 and v_yes_after = v_members and v_yes_before < v_members then
    insert into public.listing_events (listing_id, user_id, type, payload)
    values (p_keep, auth.uid(), 'matched',
            jsonb_build_object('hunt_id', v_k.hunt_id, 'completed_by', auth.uid()));
  end if;

  return p_keep;
end;
$$;

revoke execute on function public.merge_listings(uuid, uuid) from public, anon;
grant execute on function public.merge_listings(uuid, uuid) to authenticated;
