-- Saved searches and their results stay inside the hunt.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into public.signup_allowlist (entry) values ('@test.local') on conflict do nothing;
insert into auth.users (id, email) values
  ('44444444-0000-4000-a000-000000000001', 'member@test.local'),
  ('44444444-0000-4000-a000-000000000002', 'stranger@test.local');

create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

select pg_temp.login('44444444-0000-4000-a000-000000000001');
create temp table ctx as select (public.create_hunt('Browse')).id as hunt_id;
grant select on ctx to authenticated;
insert into public.saved_searches (id, hunt_id, label, url) values
  ('44444444-0000-4000-d000-000000000001', (select hunt_id from ctx), 'Search',
   'https://www.otodom.pl/pl/wyniki/wynajem/mieszkanie/warszawa');
reset role;
insert into public.search_results (search_id, external_id, hunt_id, url, title)
  values ('44444444-0000-4000-d000-000000000001', '1', (select hunt_id from ctx),
          'https://www.otodom.pl/pl/oferta/a-ID1', 'Flat');

select pg_temp.login('44444444-0000-4000-a000-000000000002');
select is_empty('select * from public.saved_searches', 'strangers see no searches');
select is_empty('select * from public.search_results', 'strangers see no results');
update public.search_results set hidden_at = now();
delete from public.saved_searches;
select throws_ok(
  $$ insert into public.saved_searches (hunt_id, label, url)
     values ((select hunt_id from ctx), 'x', 'https://www.otodom.pl/pl/wyniki/x') $$,
  '42501', null, 'strangers cannot add a search to the hunt');

select pg_temp.login('44444444-0000-4000-a000-000000000001');
select is((select count(*)::int from public.saved_searches), 1, 'stranger could not delete the search');
select is((select hidden_at from public.search_results), null, 'stranger could not hide a result');
update public.search_results set hidden_at = now();
select isnt((select hidden_at from public.search_results), null, 'members hide results');
select throws_ok(
  $$ update public.saved_searches set url = 'https://example.com/' $$,
  '23514', null, 'only Otodom search links are accepted');

select * from finish();
rollback;
