-- Milestone 8: re-check bookkeeping and duplicate merge.
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

-- Fixtures (as superuser) ------------------------------------------------------
insert into public.signup_allowlist (entry) values ('@test.local') on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data) values
  ('88888888-0000-4000-a000-00000000000a', 'ala8@test.local', '{"full_name":"Ala"}'),
  ('88888888-0000-4000-a000-00000000000b', 'bartek8@test.local', '{"full_name":"Bartek"}'),
  ('88888888-0000-4000-a000-00000000000c', 'stranger8@test.local', '{"full_name":"Cezary"}');

insert into public.hunts (id, name, created_by) values
  ('88888888-0000-4000-b000-000000000001', 'Upkeep hunt', '88888888-0000-4000-a000-00000000000a'),
  ('88888888-0000-4000-b000-000000000002', 'Other hunt', '88888888-0000-4000-a000-00000000000c');
insert into public.hunt_members (hunt_id, user_id, role) values
  ('88888888-0000-4000-b000-000000000001', '88888888-0000-4000-a000-00000000000a', 'owner'),
  ('88888888-0000-4000-b000-000000000001', '88888888-0000-4000-a000-00000000000b', 'member'),
  ('88888888-0000-4000-b000-000000000002', '88888888-0000-4000-a000-00000000000c', 'owner');

create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

create function pg_temp.lid(p_title text) returns uuid language sql as $$
  select id from public.listings where title = p_title;
$$;

-- ---------------------------------------------------------------------------
-- Re-check queue and record_listing_check
-- ---------------------------------------------------------------------------
insert into public.listings (hunt_id, added_by, title, url, rent, admin_fee, status,
                             is_active, last_checked_at, created_at) values
  ('88888888-0000-4000-b000-000000000001', '88888888-0000-4000-a000-00000000000a',
   'Never checked', 'https://otodom.pl/oferta/a', 4000, 600, 'new', true, null, now()),
  ('88888888-0000-4000-b000-000000000001', '88888888-0000-4000-a000-00000000000a',
   'Checked 2 days ago', 'https://olx.pl/d/oferta/b', 3000, null, 'new', true,
   now() - interval '2 days', now()),
  ('88888888-0000-4000-b000-000000000001', '88888888-0000-4000-a000-00000000000a',
   'Checked an hour ago', 'https://olx.pl/d/oferta/c', 3000, null, 'new', true,
   now() - interval '1 hour', now()),
  ('88888888-0000-4000-b000-000000000001', '88888888-0000-4000-a000-00000000000a',
   'Rejected', 'https://olx.pl/d/oferta/d', 3000, null, 'rejected', true, null, now()),
  ('88888888-0000-4000-b000-000000000001', '88888888-0000-4000-a000-00000000000a',
   'No URL', null, 3000, null, 'new', true, null, now()),
  ('88888888-0000-4000-b000-000000000001', '88888888-0000-4000-a000-00000000000a',
   'Removed 3 days ago', 'https://olx.pl/d/oferta/e', 3000, null, 'new', false,
   now() - interval '3 days', now()),
  ('88888888-0000-4000-b000-000000000001', '88888888-0000-4000-a000-00000000000a',
   'Removed 8 days ago', 'https://olx.pl/d/oferta/f', 3000, null, 'new', false,
   now() - interval '8 days', now());

set local role service_role;
select is(
  (select array_agg(l.title order by d.ord)
   from public.listings_due_for_check(50) with ordinality d(id, hunt_id, url, rent, is_active,
                                                             last_checked_at, total_due, ord)
   join public.listings l on l.id = d.id
   where l.hunt_id = '88888888-0000-4000-b000-000000000001'),
  array['Never checked', 'Removed 8 days ago', 'Checked 2 days ago'],
  'due: URL, not finished, active after 20h, removed after 7 days, oldest first');
select ok((select bool_and(total_due >= 3) from public.listings_due_for_check(1)),
  'total_due counts beyond the page');

-- Price drop
select is(public.record_listing_check(pg_temp.lid('Never checked'), 'alive', 3800, 600),
  array['price_changed'], 'price drop is logged');
reset role;
select is((select array[rent, admin_fee] from public.listings where title = 'Never checked'),
  array[3800, 600]::numeric[], 'new price saved');
select ok((select last_checked_at is not null from public.listings where title = 'Never checked'),
  'last_checked_at bumped');
select is(
  (select array_agg(rent order by observed_at) from public.listing_price_history
   where listing_id = pg_temp.lid('Never checked')),
  array[4000, 3800]::numeric[], 'old price backfilled before the new one');
select is(
  (select payload - 'hunt_id' from public.listing_events
   where listing_id = pg_temp.lid('Never checked') and type = 'price_changed'),
  '{"rent_before": 4000, "rent_after": 3800, "admin_fee_before": 600, "admin_fee_after": 600}'::jsonb,
  'price_changed payload');
select is(
  (select concat_ws(',', payload ->> 'hunt_id', coalesce(user_id::text, 'null'))
   from public.listing_events
   where listing_id = pg_temp.lid('Never checked') and type = 'price_changed'),
  '88888888-0000-4000-b000-000000000001,null', 'carries hunt_id, no user');

set local role service_role;
select is(public.record_listing_check(pg_temp.lid('Never checked'), 'alive', 3800, null),
  '{}'::text[], 'same price, unreadable admin fee: unchanged');
select is(public.record_listing_check(pg_temp.lid('Never checked'), 'alive', null, 650),
  array['price_changed'], 'admin fee change alone counts');
select is(public.record_listing_check(pg_temp.lid('Checked 2 days ago'), 'alive', 3000, 400),
  '{}'::text[], 'a missing admin fee is filled in quietly');
reset role;
select is((select admin_fee from public.listings where title = 'Checked 2 days ago'),
  400::numeric, 'admin fee filled');
select is((select array[rent, admin_fee] from public.listings where title = 'Never checked'),
  array[3800, 650]::numeric[], 'rent kept when unreadable');

-- Gone, unknown, restored
set local role service_role;
select is(public.record_listing_check(pg_temp.lid('Checked an hour ago'), 'unknown'),
  '{}'::text[], 'unknown logs nothing');
reset role;
select ok((select is_active and last_checked_at > now() - interval '1 minute'
           from public.listings where title = 'Checked an hour ago'),
  'unknown keeps the ad active and bumps last_checked_at');
set local role service_role;
select is(public.record_listing_check(pg_temp.lid('Checked an hour ago'), 'gone'),
  array['ad_removed'], 'gone is logged');
select is(public.record_listing_check(pg_temp.lid('Checked an hour ago'), 'gone'),
  '{}'::text[], 'already removed: logged once');
reset role;
select is(
  (select concat_ws(',', is_active, title, rent) from public.listings
   where title = 'Checked an hour ago'),
  'f,Checked an hour ago,3000.00', 'inactive, snapshot kept');
select is(
  (select payload from public.listing_events
   where listing_id = pg_temp.lid('Checked an hour ago') and type = 'ad_removed'),
  '{"hunt_id": "88888888-0000-4000-b000-000000000001"}'::jsonb, 'ad_removed payload');
set local role service_role;
select is(public.record_listing_check(pg_temp.lid('Checked an hour ago'), 'alive', 3000, null),
  array['ad_restored'], 'back online is logged');
reset role;
select ok((select is_active from public.listings where title = 'Checked an hour ago'),
  'active again');

select throws_ok(
  $$ select public.record_listing_check(pg_temp.lid('No URL'), 'maybe') $$,
  '22023', null, 'unknown result rejected');

-- Members can't call the cron functions.
select pg_temp.login('88888888-0000-4000-a000-00000000000a');
select throws_ok(
  $$ select public.record_listing_check(pg_temp.lid('No URL'), 'gone') $$,
  '42501', null, 'members cannot record checks');
select throws_ok($$ select * from public.listings_due_for_check(5) $$,
  '42501', null, 'members cannot list the queue');
reset role;

-- ---------------------------------------------------------------------------
-- merge_listings
-- ---------------------------------------------------------------------------
insert into public.listings (hunt_id, added_by, title, url, canonical_url, source, rent,
                             admin_fee, area_m2, rooms, district, address, description,
                             features, needs_details, merged_urls) values
  ('88888888-0000-4000-b000-000000000001', '88888888-0000-4000-a000-00000000000a',
   'Keep', null, null, 'facebook', 4000, null, 60, null, 'Mokotów', null, 'From FB',
   '{"balcony": true, "petsAllowed": false}', true, '{}'),
  ('88888888-0000-4000-b000-000000000001', '88888888-0000-4000-a000-00000000000b',
   'Drop', 'https://www.otodom.pl/pl/oferta/x-ID1', 'https://otodom.pl/oferta/x-ID1', 'otodom',
   4100, 700, 60.5, 3, 'Mokotów', 'Puławska 1', 'From Otodom',
   '{"elevator": true, "petsAllowed": true}', false, array['https://olx.pl/d/oferta/old']),
  ('88888888-0000-4000-b000-000000000002', '88888888-0000-4000-a000-00000000000c',
   'Elsewhere', null, null, 'other', 4000, null, 60, null, null, null, null, '{}', false, '{}');

insert into public.listing_photos (listing_id, original_url, position, is_cover) values
  (pg_temp.lid('Keep'), 'https://img/k0.jpg', 0, true),
  (pg_temp.lid('Drop'), 'https://img/d0.jpg', 0, true),
  (pg_temp.lid('Drop'), 'https://img/d1.jpg', 1, false);
insert into public.comments (listing_id, user_id, body) values
  (pg_temp.lid('Drop'), '88888888-0000-4000-a000-00000000000b', 'Nice kitchen');
insert into public.listing_price_history (listing_id, rent, admin_fee) values
  (pg_temp.lid('Drop'), 4100, 700);
-- Ala voted on both (her vote on Keep wins); Bartek only on Drop (moves over).
insert into public.votes (listing_id, user_id, swipe, stars) values
  (pg_temp.lid('Keep'), '88888888-0000-4000-a000-00000000000a', 'yes', 4),
  (pg_temp.lid('Drop'), '88888888-0000-4000-a000-00000000000a', 'no', 1),
  (pg_temp.lid('Drop'), '88888888-0000-4000-a000-00000000000b', 'yes', 5);
-- Ala's open request on Drop is answered by her yes on Keep.
insert into public.reconsider_requests (listing_id, requested_by, target_user, note) values
  (pg_temp.lid('Drop'), '88888888-0000-4000-a000-00000000000b',
   '88888888-0000-4000-a000-00000000000a', 'please');

create temp table ids as
  select pg_temp.lid('Keep') as keep_id, pg_temp.lid('Drop') as drop_id,
         pg_temp.lid('Elsewhere') as other_id;
grant select on ids to authenticated;

select pg_temp.login('88888888-0000-4000-a000-00000000000c');
select throws_ok($$ select public.merge_listings((select keep_id from ids),
                                                 (select drop_id from ids)) $$,
  'P0002', null, 'non-member cannot merge');
select throws_ok($$ select public.merge_listings((select other_id from ids),
                                                 (select drop_id from ids)) $$,
  'P0002', null, 'cannot pull in a listing from a hunt you are not in');

-- Cezary joins both hunts, so only the cross-hunt check stops him.
reset role;
insert into public.hunt_members (hunt_id, user_id) values
  ('88888888-0000-4000-b000-000000000001', '88888888-0000-4000-a000-00000000000c');
select pg_temp.login('88888888-0000-4000-a000-00000000000c');
select throws_ok($$ select public.merge_listings((select other_id from ids),
                                                 (select drop_id from ids)) $$,
  '22023', null, 'cross-hunt merge refused');
reset role;
delete from public.hunt_members where user_id = '88888888-0000-4000-a000-00000000000c'
  and hunt_id = '88888888-0000-4000-b000-000000000001';

select pg_temp.login('88888888-0000-4000-a000-00000000000a');
select throws_ok($$ select public.merge_listings((select keep_id from ids),
                                                 (select keep_id from ids)) $$,
  '22023', null, 'cannot merge into itself');
select is(public.merge_listings((select keep_id from ids), (select drop_id from ids)),
  (select keep_id from ids), 'merge returns the kept id');
reset role;

select ok(not exists (select 1 from public.listings where id = (select drop_id from ids)),
  'dropped listing deleted');
select is(
  (select concat_ws('|', title, url, canonical_url, source, rent, admin_fee, area_m2, rooms,
                    address, description, needs_details)
   from public.listings where id = (select keep_id from ids)),
  'Keep|https://www.otodom.pl/pl/oferta/x-ID1|https://otodom.pl/oferta/x-ID1|otodom|4000.00|'
    || '700.00|60.00|3|Puławska 1|From FB|f',
  'empty fields filled (URL with its source), set ones kept');
select is((select features from public.listings where id = (select keep_id from ids)),
  '{"balcony": true, "elevator": true, "petsAllowed": false}'::jsonb,
  'features combined, kept values win');
select is((select merged_urls from public.listings where id = (select keep_id from ids)),
  array['https://olx.pl/d/oferta/old'], 'earlier merged URLs carried over');
select is(
  (select array_agg(original_url || ':' || position || ':' || is_cover order by position)
   from public.listing_photos where listing_id = (select keep_id from ids)),
  array['https://img/k0.jpg:0:true', 'https://img/d0.jpg:1:false', 'https://img/d1.jpg:2:false'],
  'photos appended, one cover');
select is((select count(*)::int from public.comments where listing_id = (select keep_id from ids)),
  1, 'comments moved');
select is(
  (select count(*)::int from public.listing_price_history
   where listing_id = (select keep_id from ids)), 1, 'price history moved');
select is(
  (select array_agg(user_id::text || ':' || swipe || ':' || stars order by user_id)
   from public.votes where listing_id = (select keep_id from ids)),
  array['88888888-0000-4000-a000-00000000000a:yes:4', '88888888-0000-4000-a000-00000000000b:yes:5'],
  'kept vote wins, missing vote moves over');
select is(
  (select concat_ws(',', outcome, resolved_at is not null) from public.reconsider_requests
   where listing_id = (select keep_id from ids)),
  'yes,t', 'request answered by the kept vote and moved');
select is(
  (select payload - 'hunt_id' - 'dropped_id' from public.listing_events
   where listing_id = (select keep_id from ids) and type = 'merged'),
  '{"kept_title": "Keep", "dropped_title": "Drop"}'::jsonb, 'merged event');
select is(
  (select count(*)::int from public.listing_events
   where listing_id = (select keep_id from ids) and type = 'matched'),
  1, 'votes moving over can complete a match');

-- A second merge with a URL: the dropped canonical URL is remembered.
insert into public.listings (hunt_id, added_by, title, url, canonical_url) values
  ('88888888-0000-4000-b000-000000000001', '88888888-0000-4000-a000-00000000000b',
   'Drop 2', 'https://olx.pl/d/oferta/two', 'https://olx.pl/d/oferta/two');
select pg_temp.login('88888888-0000-4000-a000-00000000000b');
select lives_ok($$ select public.merge_listings((select keep_id from ids),
                                                pg_temp.lid('Drop 2')) $$, 'second merge');
reset role;
select is((select merged_urls from public.listings where id = (select keep_id from ids)),
  array['https://olx.pl/d/oferta/old', 'https://olx.pl/d/oferta/two'],
  'dropped canonical URL kept in merged_urls');
select is((select url from public.listings where id = (select keep_id from ids)),
  'https://www.otodom.pl/pl/oferta/x-ID1', 'kept URL not overwritten');

select * from finish();
rollback;
