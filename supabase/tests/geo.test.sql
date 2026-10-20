-- Milestone 5: pins are managed by any member and nobody else; the geocode
-- cache belongs to the edge function's service role alone.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into public.signup_allowlist (entry) values ('@test.local') on conflict do nothing;
insert into auth.users (id, email) values
  ('33333333-0000-4000-a000-000000000001', 'owner@test.local'),
  ('33333333-0000-4000-a000-000000000002', 'member@test.local'),
  ('33333333-0000-4000-a000-000000000003', 'stranger@test.local');
insert into public.geocode_cache (query, lat, lng, display_name)
  values ('puławska 145, warszawa', 52.18, 21.0, 'Puławska 145');

create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

select pg_temp.login('33333333-0000-4000-a000-000000000001');
create temp table ctx as select (public.create_hunt('Pins')).id as hunt_id;
grant select on ctx to authenticated;
reset role;
insert into public.hunt_members (hunt_id, user_id)
  values ((select hunt_id from ctx), '33333333-0000-4000-a000-000000000002');

-- A plain member adds, edits and deletes pins.
select pg_temp.login('33333333-0000-4000-a000-000000000002');
select lives_ok(
  $$ insert into public.pins (hunt_id, label, lat, lng, kind)
     values ((select hunt_id from ctx), 'Office', 52.23, 21.01, 'work'),
            ((select hunt_id from ctx), 'Mum', 52.25, 20.95, 'family') $$,
  'member adds pins');
update public.pins set label = 'New office' where label = 'Office';
select is((select label from public.pins where kind = 'work'), 'New office', 'member edits a pin');
delete from public.pins where kind = 'family';
select is((select count(*)::int from public.pins), 1, 'member deletes a pin');
select throws_ok(
  $$ insert into public.pins (hunt_id, label, lat, lng)
     values ((select hunt_id from ctx), 'Moon', 95, 0) $$,
  '23514', null, 'coordinates are range-checked');

-- A stranger can't see or touch them.
select pg_temp.login('33333333-0000-4000-a000-000000000003');
select is_empty('select * from public.pins', 'stranger: no pins');
update public.pins set label = 'hacked';
delete from public.pins;
reset role;
select is((select label from public.pins where hunt_id = (select hunt_id from ctx)),
          'New office', 'stranger: updates and deletes do nothing');

-- geocode_cache: no client access at all.
select pg_temp.login('33333333-0000-4000-a000-000000000002');
select throws_ok('select * from public.geocode_cache', '42501', null,
  'member cannot read the geocode cache');
select throws_ok(
  $$ insert into public.geocode_cache (query, lat, lng) values ('planted', 1, 1) $$,
  '42501', null, 'member cannot write the geocode cache');
select throws_ok(
  $$ delete from public.geocode_cache $$,
  '42501', null, 'member cannot clear the geocode cache');
reset role;
set local role anon;
select throws_ok('select * from public.geocode_cache', '42501', null,
  'anon cannot read the geocode cache');
reset role;
set local role service_role;
select is((select lat from public.geocode_cache where query = 'puławska 145, warszawa'), 52.18::float8,
  'service role reads the cache');
reset role;
select throws_ok(
  $$ insert into public.geocode_cache (query, lat) values ('half', 1) $$,
  '23514', null, 'a hit needs both coordinates');

select * from finish();
rollback;
