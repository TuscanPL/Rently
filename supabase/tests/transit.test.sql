-- listing_routes: members read, nobody but the service role writes, and a
-- route is dropped when either end moves or the pin's arrival time changes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into public.signup_allowlist (entry) values ('@test.local') on conflict do nothing;
insert into auth.users (id, email) values
  ('33333333-0000-4000-a000-000000000001', 'member@test.local'),
  ('33333333-0000-4000-a000-000000000002', 'stranger@test.local');

create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

select pg_temp.login('33333333-0000-4000-a000-000000000001');
create temp table ctx as select (public.create_hunt('Transit')).id as hunt_id;
grant select on ctx to authenticated;
insert into public.pins (id, hunt_id, label, lat, lng)
  values ('33333333-0000-4000-c000-000000000001', (select hunt_id from ctx), 'Work', 52.23, 21.01);
insert into public.listings (id, hunt_id, title, lat, lng)
  values ('33333333-0000-4000-b000-000000000001', (select hunt_id from ctx), 'Flat', 52.18, 21.0);

select is((select arrive_weekday::int || ' ' || arrive_time::text from public.pins),
          '2 09:00:00', 'pins default to arriving Tuesday 9:00');
select throws_ok($$ update public.pins set arrive_weekday = 8 $$, '23514', null,
                 'weekday must be 1..7');
select throws_ok(
  $$ insert into public.listing_routes (listing_id, pin_id, status)
     values ('33333333-0000-4000-b000-000000000001', '33333333-0000-4000-c000-000000000001', 'ok') $$,
  '42501', null, 'members cannot write routes');

-- The edge function writes as the service role.
reset role;
insert into public.listing_routes (listing_id, pin_id, status, duration_min)
  values ('33333333-0000-4000-b000-000000000001', '33333333-0000-4000-c000-000000000001', 'ok', 30);

select pg_temp.login('33333333-0000-4000-a000-000000000001');
select is((select duration_min from public.listing_routes), 30, 'members read routes');
select pg_temp.login('33333333-0000-4000-a000-000000000002');
select is_empty('select * from public.listing_routes', 'strangers see nothing');

-- Edits that don't change the trip keep it.
select pg_temp.login('33333333-0000-4000-a000-000000000001');
update public.pins set label = 'Office';
update public.listings set title = 'Nice flat';
select is((select count(*)::int from public.listing_routes), 1, 'renames keep the route');

update public.pins set arrive_time = '08:30';
select is((select count(*)::int from public.listing_routes), 0, 'new arrival time drops the route');

reset role;
insert into public.listing_routes (listing_id, pin_id, status)
  values ('33333333-0000-4000-b000-000000000001', '33333333-0000-4000-c000-000000000001', 'ok');
select pg_temp.login('33333333-0000-4000-a000-000000000001');
update public.listings set lat = 52.19;
select is((select count(*)::int from public.listing_routes), 0, 'moving the listing drops the route');

reset role;
insert into public.listing_routes (listing_id, pin_id, status)
  values ('33333333-0000-4000-b000-000000000001', '33333333-0000-4000-c000-000000000001', 'ok');
select pg_temp.login('33333333-0000-4000-a000-000000000001');
update public.pins set lng = 21.02;
select is((select count(*)::int from public.listing_routes), 0, 'moving the pin drops the route');

reset role;
insert into public.listing_routes (listing_id, pin_id, status)
  values ('33333333-0000-4000-b000-000000000001', '33333333-0000-4000-c000-000000000001', 'ok');
select pg_temp.login('33333333-0000-4000-a000-000000000001');
delete from public.pins;
reset role;
select is((select count(*)::int from public.listing_routes
           where listing_id = '33333333-0000-4000-b000-000000000001'), 0,
          'deleting the pin deletes its routes');

select * from finish();
rollback;
