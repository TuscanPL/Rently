-- Milestone 4: criteria violations, the status trigger, comments and viewing notes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- Fixtures (as superuser) ------------------------------------------------------
insert into public.signup_allowlist (entry) values ('@test.local') on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data) values
  ('44444444-0000-4000-a000-00000000000a', 'ala4@test.local', '{"full_name":"Ala"}'),
  ('44444444-0000-4000-a000-00000000000b', 'bartek4@test.local', '{"full_name":"Bartek"}'),
  ('44444444-0000-4000-a000-00000000000c', 'stranger4@test.local', '{"full_name":"Cezary"}');

insert into public.hunts (id, name, created_by) values
  ('44444444-0000-4000-b000-000000000001', 'Organize hunt',
   '44444444-0000-4000-a000-00000000000a'),
  ('44444444-0000-4000-b000-000000000002', 'Stranger hunt',
   '44444444-0000-4000-a000-00000000000c');
insert into public.hunt_members (hunt_id, user_id, role) values
  ('44444444-0000-4000-b000-000000000001', '44444444-0000-4000-a000-00000000000a', 'owner'),
  ('44444444-0000-4000-b000-000000000001', '44444444-0000-4000-a000-00000000000b', 'member'),
  ('44444444-0000-4000-b000-000000000002', '44444444-0000-4000-a000-00000000000c', 'owner');

-- SKM Służewiec; a pin of another hunt with the same coordinates must never be used.
insert into public.pins (id, hunt_id, label, lat, lng, kind) values
  ('44444444-0000-4000-c000-000000000001', '44444444-0000-4000-b000-000000000001',
   'SKM Służewiec', 52.1808, 20.9997, 'station'),
  ('44444444-0000-4000-c000-000000000002', '44444444-0000-4000-b000-000000000002',
   'Elsewhere', 52.1808, 20.9997, 'other');

insert into public.listings (id, hunt_id, added_by, title) values
  ('44444444-0000-4000-d000-000000000001', '44444444-0000-4000-b000-000000000001',
   '44444444-0000-4000-a000-00000000000a', 'Pipeline flat');

create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

-- A listing row built from defaults plus overrides, checked against criteria.
create function pg_temp.v(p_listing jsonb, p_criteria jsonb) returns jsonb language sql as $$
  select public.listing_criteria_violations(
    jsonb_populate_record(
      null::public.listings,
      jsonb_build_object('id', gen_random_uuid(),
                         'hunt_id', '44444444-0000-4000-b000-000000000001',
                         'advertiser_type', 'unknown', 'features', '{}'::jsonb) || p_listing),
    p_criteria);
$$;

create function pg_temp.codes(p_listing jsonb, p_criteria jsonb) returns text[] language sql as $$
  select coalesce(array_agg(e ->> 'code'), '{}')
  from jsonb_array_elements(pg_temp.v(p_listing, p_criteria)) e;
$$;

-- Criteria rules ----------------------------------------------------------------
select is(pg_temp.v('{"rent": 5000}', '{}'), '[]'::jsonb, 'no criteria, no violations');
select is(pg_temp.v('{"rent": 4000, "admin_fee": 900, "utilities_estimate": 500}',
                    '{"maxTotalMonthly": 5000}'),
          '[{"code": "max_total", "limit": 5000, "actual": 5400}]'::jsonb,
          'max_total: rent + admin fee + utilities over the budget, with limit and actual');
select is(pg_temp.codes('{"rent": 4000, "admin_fee": 1000}', '{"maxTotalMonthly": 5000}'), '{}',
          'max_total: exactly on budget is fine');
select is(pg_temp.codes('{"admin_fee": 6000}', '{"maxTotalMonthly": 5000}'), '{}',
          'max_total: unknown rent is not a violation');

select is(pg_temp.v('{"rooms": 2}', '{"minRooms": 3}'),
          '[{"code": "min_rooms", "limit": 3, "actual": 2}]'::jsonb, 'min_rooms');
select is(pg_temp.codes('{"rooms": 3}', '{"minRooms": 3}'), '{}', 'min_rooms: enough rooms');
select is(pg_temp.codes('{}', '{"minRooms": 3}'), '{}', 'min_rooms: unknown rooms');

select is(pg_temp.v('{"area_m2": 48.5}', '{"minAreaM2": 55}'),
          '[{"code": "min_area", "limit": 55, "actual": 48.5}]'::jsonb, 'min_area');
select is(pg_temp.codes('{}', '{"minAreaM2": 55}'), '{}', 'min_area: unknown area');

select is(pg_temp.v('{"district": "Wola"}', '{"allowedDistricts": ["Mokotów", "Ochota"]}'),
          '[{"code": "district", "actual": "Wola", "allowed": ["Mokotów", "Ochota"]}]'::jsonb,
          'district outside the allowed list');
select is(pg_temp.codes('{"district": "mokotów, Służew"}', '{"allowedDistricts": ["Mokotów"]}'),
          '{}', 'district: case-insensitive, matches inside a longer district');
select is(pg_temp.codes('{}', '{"allowedDistricts": ["Mokotów"]}'), '{}',
          'district: unknown district');
select is(pg_temp.codes('{"district": "Wola"}', '{"allowedDistricts": ["  "]}'), '{}',
          'district: blank entries mean no restriction');

select is(pg_temp.v('{"lat": 52.1970, "lng": 20.9997}',
                    '{"maxDistanceKm": 1.5, "distancePinId": "44444444-0000-4000-c000-000000000001"}'),
          '[{"code": "max_distance", "limit": 1.5, "actual": 1.80,
             "pin_id": "44444444-0000-4000-c000-000000000001", "pin_label": "SKM Służewiec"}]'::jsonb,
          'max_distance: haversine km to the chosen pin, rounded to 2 decimals');
select is(pg_temp.codes('{"lat": 52.1850, "lng": 21.0010}',
                        '{"maxDistanceKm": 1.5, "distancePinId": "44444444-0000-4000-c000-000000000001"}'),
          '{}', 'max_distance: close enough');
select is(pg_temp.codes('{}',
                        '{"maxDistanceKm": 1.5, "distancePinId": "44444444-0000-4000-c000-000000000001"}'),
          '{}', 'max_distance: no coordinates');
select is(pg_temp.codes('{"lat": 53, "lng": 21}',
                        '{"maxDistanceKm": 1.5, "distancePinId": "44444444-0000-4000-c000-000000000002"}'),
          '{}', 'max_distance: a pin from another hunt is ignored');
select is(pg_temp.codes('{"lat": 53, "lng": 21}', '{"maxDistanceKm": 1.5}'), '{}',
          'max_distance: no pin chosen');

select is(pg_temp.v('{"advertiser_type": "agency"}', '{"privateOnly": true}'),
          '[{"code": "private_only"}]'::jsonb, 'private_only: agency');
select is(pg_temp.codes('{"advertiser_type": "unknown"}', '{"privateOnly": true}'), '{}',
          'private_only: unknown advertiser');
select is(pg_temp.codes('{"advertiser_type": "agency"}', '{"privateOnly": false}'), '{}',
          'private_only: off');

select is(pg_temp.codes('{"features": {"petsAllowed": false}}', '{"petsAllowed": true}'),
          '{pets}', 'pets: the ad says no pets');
select is(pg_temp.codes('{}', '{"petsAllowed": true}'), '{}', 'pets: not mentioned');

select is(pg_temp.v('{"available_from": "2026-12-15"}',
                    '{"availableFrom": "2026-11-01", "availableTo": "2026-12-01"}'),
          '[{"code": "available_from", "actual": "2026-12-15", "from": "2026-11-01",
             "to": "2026-12-01"}]'::jsonb, 'available_from: too late');
select is(pg_temp.codes('{"available_from": "2026-10-01"}', '{"availableFrom": "2026-11-01"}'),
          '{available_from}', 'available_from: too early, open-ended window');
select is(pg_temp.codes('{"available_from": "2026-11-10"}',
                        '{"availableFrom": "2026-11-01", "availableTo": "2026-12-01"}'),
          '{}', 'available_from: inside the window');
select is(pg_temp.codes('{}', '{"availableFrom": "2026-11-01"}'), '{}',
          'available_from: unknown date');

select is(pg_temp.codes('{"features": {"parking": false, "balcony": false}}',
                        '{"parking": true, "balcony": true}'),
          '{parking,balcony}', 'parking and balcony: the ad says none');
select is(pg_temp.codes('{"features": {"parking": true}}', '{"parking": true, "balcony": true}'),
          '{}', 'parking and balcony: present or not mentioned');

select is(pg_temp.v('{"floor": 4, "features": {"elevator": false}}', '{"elevatorAboveFloor": 2}'),
          '[{"code": "elevator", "floor": 4, "limit": 2}]'::jsonb,
          'elevator: above the floor limit without an elevator');
select is(pg_temp.codes('{"floor": 2, "features": {"elevator": false}}', '{"elevatorAboveFloor": 2}'),
          '{}', 'elevator: at the floor limit is fine');
select is(pg_temp.codes('{"floor": 5}', '{"elevatorAboveFloor": 2}'), '{}',
          'elevator: unknown elevator');

select is(pg_temp.codes('{"rent": 9000, "rooms": 1}',
                        '{"maxTotalMonthly": "lots", "minRooms": [3], "availableFrom": "soon"}'),
          '{}', 'malformed criteria values are ignored, not errors');

-- Summaries carry the violations -------------------------------------------------
reset role;
update public.hunts set criteria = '{"minRooms": 3}'
  where id = '44444444-0000-4000-b000-000000000001';
update public.listings set rooms = 2 where id = '44444444-0000-4000-d000-000000000001';
select pg_temp.login('44444444-0000-4000-a000-00000000000b');
select is((select criteria_violations from public.hunt_listing_summaries(
             '44444444-0000-4000-b000-000000000001')),
          '[{"code": "min_rooms", "limit": 3, "actual": 2}]'::jsonb,
          'hunt_listing_summaries reports the violations');

-- Status trigger ----------------------------------------------------------------
update public.listings set status = 'contacted'
  where id = '44444444-0000-4000-d000-000000000001';
select is((select payload from public.listing_events where type = 'status_changed'),
          '{"from": "new", "to": "contacted", "hunt_id": "44444444-0000-4000-b000-000000000001"}'::jsonb,
          'status change logs status_changed with from, to and hunt_id');
select is((select user_id from public.listing_events where type = 'status_changed'),
          '44444444-0000-4000-a000-00000000000b'::uuid, 'the event names who changed it');

update public.listings set status = 'viewing_booked', viewing_at = '2026-11-12 17:00+00'
  where id = '44444444-0000-4000-d000-000000000001';
select is((select count(*)::int from public.listing_events where type = 'status_changed'), 2,
          'one event per change');
select is((select payload ->> 'viewing_at' from public.listing_events
           where type = 'viewing_scheduled'),
          '2026-11-12T17:00:00+00:00', 'booking a time logs viewing_scheduled');

update public.listings set title = 'Renamed' where id = '44444444-0000-4000-d000-000000000001';
select is((select count(*)::int from public.listing_events
           where type in ('status_changed', 'viewing_scheduled')), 3,
          'other edits log nothing');

-- Comments and viewing notes -----------------------------------------------------
insert into public.comments (listing_id, body)
  values ('44444444-0000-4000-d000-000000000001', 'Call them tomorrow?');
select is((select payload ->> 'kind' from public.listing_events where type = 'commented'),
          'comment', 'a comment logs commented');

select lives_ok(
  $$ insert into public.comments (listing_id, body, kind, ratings)
     values ('44444444-0000-4000-d000-000000000001', 'Bright, a bit loud', 'viewing_note',
             '{"smell": "good", "light": "good", "noise": "bad", "landlord": "ok"}') $$,
  'a member adds a viewing note with ratings');
select throws_ok(
  $$ insert into public.comments (listing_id, body, kind, ratings)
     values ('44444444-0000-4000-d000-000000000001', '', 'viewing_note', '{"smell": 5}') $$,
  '23514', null, 'ratings must be good, ok or bad');
select throws_ok(
  $$ insert into public.comments (listing_id, body, ratings)
     values ('44444444-0000-4000-d000-000000000001', 'x', '{"smell": "good"}') $$,
  '23514', null, 'plain comments carry no ratings');

-- Ala can't edit or delete Bartek's comments.
select pg_temp.login('44444444-0000-4000-a000-00000000000a');
update public.comments set body = 'hacked';
delete from public.comments;
select is((select count(*)::int from public.comments where body <> 'hacked'), 2,
          'members cannot edit or delete other members'' comments');

-- A stranger sees nothing and can't post.
select pg_temp.login('44444444-0000-4000-a000-00000000000c');
select is_empty('select * from public.comments', 'stranger: no comments');
select throws_ok(
  $$ insert into public.comments (listing_id, body)
     values ('44444444-0000-4000-d000-000000000001', 'hi') $$,
  '42501', null, 'stranger cannot comment');

select * from finish();
rollback;
