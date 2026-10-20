-- Milestone 4: organize (hunt criteria, status pipeline, comments, viewing notes).
--
-- Event types written here (payload always carries hunt_id, like milestone 3's):
--   status_changed     {from, to, hunt_id}       listings.status changed, whoever changed it
--   viewing_scheduled  {viewing_at, hunt_id}     listings.viewing_at set or moved
--   commented          {comment_id, kind, hunt_id}  a comment or a viewing note was posted

-- ---------------------------------------------------------------------------
-- Criteria violations
-- ---------------------------------------------------------------------------
-- Small readers for hunts.criteria. The app validates criteria with zod
-- (huntCriteriaSchema), but a malformed value must never break the summaries:
-- anything of the wrong type reads as "not set".
create function public.jsonb_number(p jsonb)
returns numeric
language sql immutable set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric end;
$$;

create function public.jsonb_date(p jsonb)
returns date
language plpgsql immutable set search_path = ''
as $$
begin
  if jsonb_typeof(p) <> 'string' or (p #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return (p #>> '{}')::date;
exception when others then
  return null;
end;
$$;

-- Great-circle distance in kilometres (same formula and radius as
-- packages/shared/src/distance.ts).
create function public.haversine_km(
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision
)
returns double precision
language sql immutable set search_path = ''
as $$
  select 2 * 6371.0088 * asin(least(1, sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  )));
$$;

-- The criteria a listing breaks, as a JSON array of {code, …details}. Unknown
-- values (no rent, no district, no coordinates, feature not mentioned) never
-- count as a violation. Codes and shapes (mirrored in packages/shared/src/criteria.ts):
--   {code: 'max_total', limit, actual}         rent + admin fee + utilities > maxTotalMonthly
--   {code: 'min_rooms', limit, actual}
--   {code: 'min_area', limit, actual}
--   {code: 'district', actual, allowed}        district matches none of allowedDistricts
--                                              (case-insensitive; "Mokotów, Służew" matches "Mokotów")
--   {code: 'max_distance', limit, actual, pin_id, pin_label}   km to distancePinId, 2 decimals
--   {code: 'private_only'}                     advertiser is an agency
--   {code: 'pets'}                             the ad says no pets
--   {code: 'available_from', actual, from, to} available date outside the window (either end optional)
--   {code: 'parking'} / {code: 'balcony'}      the ad says there is none
--   {code: 'elevator', floor, limit}           above floor `limit` and the ad says no elevator
create function public.listing_criteria_violations(p_listing public.listings, p_criteria jsonb)
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  c jsonb := coalesce(p_criteria, '{}'::jsonb);
  f jsonb := coalesce(p_listing.features, '{}'::jsonb);
  out jsonb := '[]'::jsonb;
  v_num numeric;
  v_total numeric;
  v_allowed jsonb;
  v_pin record;
  v_km numeric;
  v_from date;
  v_to date;
begin
  if jsonb_typeof(c) <> 'object' then
    return out;
  end if;

  v_num := public.jsonb_number(c -> 'maxTotalMonthly');
  if v_num is not null and p_listing.rent is not null then
    v_total := p_listing.rent + coalesce(p_listing.admin_fee, 0)
               + coalesce(p_listing.utilities_estimate, 0);
    if v_total > v_num then
      out := out || jsonb_build_object('code', 'max_total', 'limit', v_num, 'actual', v_total);
    end if;
  end if;

  v_num := public.jsonb_number(c -> 'minRooms');
  if v_num is not null and p_listing.rooms is not null and p_listing.rooms < v_num then
    out := out || jsonb_build_object('code', 'min_rooms', 'limit', v_num,
                                     'actual', p_listing.rooms);
  end if;

  v_num := public.jsonb_number(c -> 'minAreaM2');
  if v_num is not null and p_listing.area_m2 is not null and p_listing.area_m2 < v_num then
    out := out || jsonb_build_object('code', 'min_area', 'limit', v_num,
                                     'actual', p_listing.area_m2);
  end if;

  -- Only non-blank strings count; an empty list means "anywhere".
  select coalesce(jsonb_agg(trim(e)), '[]'::jsonb) into v_allowed
  from jsonb_array_elements_text(
         case when jsonb_typeof(c -> 'allowedDistricts') = 'array'
              then c -> 'allowedDistricts' else '[]'::jsonb end) e
  where trim(e) <> '';
  if jsonb_array_length(v_allowed) > 0 and nullif(trim(p_listing.district), '') is not null
     and not exists (
       select 1 from jsonb_array_elements_text(v_allowed) a
       where position(lower(a) in lower(p_listing.district)) > 0
     ) then
    out := out || jsonb_build_object('code', 'district', 'actual', trim(p_listing.district),
                                     'allowed', v_allowed);
  end if;

  v_num := public.jsonb_number(c -> 'maxDistanceKm');
  if v_num is not null and jsonb_typeof(c -> 'distancePinId') = 'string'
     and p_listing.lat is not null and p_listing.lng is not null then
    select p.id, p.label, p.lat, p.lng into v_pin
    from public.pins p
    where p.hunt_id = p_listing.hunt_id and p.id::text = c ->> 'distancePinId';
    if found then
      v_km := round(public.haversine_km(p_listing.lat, p_listing.lng, v_pin.lat, v_pin.lng)::numeric, 2);
      if v_km > v_num then
        out := out || jsonb_build_object('code', 'max_distance', 'limit', v_num, 'actual', v_km,
                                         'pin_id', v_pin.id, 'pin_label', v_pin.label);
      end if;
    end if;
  end if;

  if c -> 'privateOnly' = 'true'::jsonb and p_listing.advertiser_type = 'agency' then
    out := out || jsonb_build_object('code', 'private_only');
  end if;

  if c -> 'petsAllowed' = 'true'::jsonb and f -> 'petsAllowed' = 'false'::jsonb then
    out := out || jsonb_build_object('code', 'pets');
  end if;

  v_from := public.jsonb_date(c -> 'availableFrom');
  v_to := public.jsonb_date(c -> 'availableTo');
  if p_listing.available_from is not null
     and (p_listing.available_from < v_from or p_listing.available_from > v_to) then
    out := out || jsonb_build_object('code', 'available_from', 'actual', p_listing.available_from,
                                     'from', v_from, 'to', v_to);
  end if;

  if c -> 'parking' = 'true'::jsonb and f -> 'parking' = 'false'::jsonb then
    out := out || jsonb_build_object('code', 'parking');
  end if;

  if c -> 'balcony' = 'true'::jsonb and f -> 'balcony' = 'false'::jsonb then
    out := out || jsonb_build_object('code', 'balcony');
  end if;

  v_num := public.jsonb_number(c -> 'elevatorAboveFloor');
  if v_num is not null and p_listing.floor is not null and p_listing.floor > v_num
     and f -> 'elevator' = 'false'::jsonb then
    out := out || jsonb_build_object('code', 'elevator', 'floor', p_listing.floor, 'limit', v_num);
  end if;

  return out;
end;
$$;

-- Same as milestone 3's version, except criteria_violations is now filled in.
create or replace function public.hunt_listing_summaries(p_hunt_id uuid)
returns table (
  listing_id uuid,
  total_monthly numeric,
  my_swipe public.swipe,
  my_stars smallint,
  member_votes jsonb,
  voted_count int,
  member_count int,
  votes_revealed boolean,
  combined_score numeric,
  is_match boolean,
  is_disagreement boolean,
  is_maybe boolean,
  reconsider_pending boolean,
  still_no boolean,
  criteria_violations jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_hide_stars boolean;
  v_criteria jsonb;
  v_member_count int;
begin
  if not public.is_hunt_member(p_hunt_id) then
    raise exception 'not a member of this hunt' using errcode = '42501';
  end if;

  select h.reveal_votes_after_both, h.criteria into v_hide_stars, v_criteria
  from public.hunts h where h.id = p_hunt_id;
  select count(*) into v_member_count from public.hunt_members m where m.hunt_id = p_hunt_id;

  return query
  with members as (
    select m.user_id, m.joined_at, p.display_name
    from public.hunt_members m
    join public.profiles p on p.id = m.user_id
    where m.hunt_id = p_hunt_id
  ), stats as (
    select
      l.id,
      l.rent,
      l.admin_fee,
      l.utilities_estimate,
      public.listing_criteria_violations(l, v_criteria) as violations,
      s.voted,
      s.yes_n,
      s.no_n,
      s.maybe_n,
      s.avg_stars,
      s.star_spread,
      (not v_hide_stars or s.voted = v_member_count) as revealed
    from public.listings l
    cross join lateral (
      select count(v.user_id)::int as voted,
             (count(*) filter (where v.swipe = 'yes'))::int as yes_n,
             (count(*) filter (where v.swipe = 'no'))::int as no_n,
             (count(*) filter (where v.swipe = 'maybe'))::int as maybe_n,
             avg(v.stars) as avg_stars,
             max(v.stars) - min(v.stars) as star_spread
      from members m
      join public.votes v on v.listing_id = l.id and v.user_id = m.user_id
    ) s
    where l.hunt_id = p_hunt_id
  )
  select
    st.id,
    case when st.rent is null then null
         else st.rent + coalesce(st.admin_fee, 0) + coalesce(st.utilities_estimate, 0) end,
    mine.swipe,
    mine.stars,
    (select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', m.user_id,
               'display_name', m.display_name,
               'swipe', v.swipe,
               'stars', case when m.user_id = auth.uid() or st.revealed then v.stars end)
             order by m.joined_at, m.user_id), '[]'::jsonb)
     from members m
     left join public.votes v on v.listing_id = st.id and v.user_id = m.user_id),
    st.voted,
    v_member_count,
    st.revealed,
    case
      when not st.revealed then null
      when st.avg_stars is null then case when st.yes_n = v_member_count then 1.0 end
      else round(st.avg_stars, 2) + case when st.yes_n = v_member_count then 1 else 0 end
    end,
    v_member_count > 0 and st.yes_n = v_member_count,
    (st.yes_n > 0 and st.no_n > 0) or (st.revealed and coalesce(st.star_spread, 0) >= 2),
    st.maybe_n > 0,
    exists (select 1 from public.reconsider_requests r
            where r.listing_id = st.id and r.resolved_at is null),
    coalesce((select r.outcome = 'no' from public.reconsider_requests r
              where r.listing_id = st.id and r.resolved_at is not null
              order by r.resolved_at desc limit 1), false),
    st.violations
  from stats st
  left join public.votes mine on mine.listing_id = st.id and mine.user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Status pipeline: every change is logged, whoever makes it
-- ---------------------------------------------------------------------------
create function public.listings_after_status_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  -- The service role (e.g. a scheduled job) has no user: log it without one.
  v_user uuid := (select id from public.profiles where id = auth.uid());
begin
  if new.status is distinct from old.status then
    insert into public.listing_events (listing_id, user_id, type, payload)
    values (new.id, v_user, 'status_changed',
            jsonb_build_object('from', old.status, 'to', new.status, 'hunt_id', new.hunt_id));
  end if;
  if new.viewing_at is distinct from old.viewing_at and new.viewing_at is not null then
    insert into public.listing_events (listing_id, user_id, type, payload)
    values (new.id, v_user, 'viewing_scheduled',
            jsonb_build_object('viewing_at', new.viewing_at, 'hunt_id', new.hunt_id));
  end if;
  return null;
end;
$$;

create trigger listings_after_status_change
  after update of status, viewing_at on public.listings
  for each row execute function public.listings_after_status_change();

-- ---------------------------------------------------------------------------
-- Comments and post-viewing notes
-- ---------------------------------------------------------------------------
-- A viewing note is a comment with kind = 'viewing_note' and structured ratings:
-- {smell, light, noise, landlord}, each 'good' | 'ok' | 'bad' (any may be missing).
create function public.valid_viewing_ratings(p jsonb)
returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and not exists (
       select 1 from jsonb_each(p) r
       where r.key not in ('smell', 'light', 'noise', 'landlord')
          or r.value not in ('"good"'::jsonb, '"ok"'::jsonb, '"bad"'::jsonb)
     );
$$;

alter table public.comments add column ratings jsonb;
alter table public.comments
  add constraint comments_body_length check (length(body) <= 4000),
  add constraint comments_photo_count check (cardinality(photo_paths) <= 10),
  add constraint comments_ratings_shape check (
    ratings is null or (kind = 'viewing_note' and public.valid_viewing_ratings(ratings))
  );

-- The milestone 1 update policy let an author move their comment to a listing
-- in another hunt; keep it inside hunts the author belongs to.
drop policy comments_update on public.comments;
create policy comments_update on public.comments for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_listing_member(listing_id));

create function public.comments_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_hunt_id uuid;
begin
  select hunt_id into v_hunt_id from public.listings where id = new.listing_id;
  insert into public.listing_events (listing_id, user_id, type, payload)
  values (new.listing_id, new.user_id, 'commented',
          jsonb_build_object('comment_id', new.id, 'kind', new.kind, 'hunt_id', v_hunt_id));
  return null;
end;
$$;

create trigger comments_after_insert
  after insert on public.comments
  for each row execute function public.comments_after_insert();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- The criteria helpers are internal: hunt_listing_summaries calls them as its owner.
revoke execute on function
  public.jsonb_number(jsonb),
  public.jsonb_date(jsonb),
  public.haversine_km(double precision, double precision, double precision, double precision),
  public.listing_criteria_violations(public.listings, jsonb),
  public.listings_after_status_change(),
  public.comments_after_insert()
from public, anon, authenticated;
