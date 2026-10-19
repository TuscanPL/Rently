begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into public.signup_allowlist (entry) values ('@test.local') on conflict do nothing;
insert into auth.users (id, email) values
  ('22222222-0000-4000-a000-000000000001', 'a@test.local'),
  ('22222222-0000-4000-a000-000000000002', 'b@test.local');

select set_config('request.jwt.claims',
  '{"sub":"22222222-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(public.claim_fetch_slot('example.com', 3000), 0, 'first fetch goes now');
select is(public.claim_fetch_slot('example.com', 3000), 3000, 'second waits 3s');
select is(public.claim_fetch_slot('other.com', 3000), 0, 'domains are independent');

create temp table h as select (public.create_hunt('Dupes')).id;
insert into public.listings (hunt_id, title, rent, area_m2, district) values
  ((select id from h), 'A', 4000, 60, 'Mokotów'),
  ((select id from h), 'B', 4050, 60.8, ' mokotów'),
  ((select id from h), 'C', 4300, 60, 'Mokotów');
select is(
  (select array_agg(d.title order by d.title) from public.listing_possible_duplicates(
     (select id from public.listings where title = 'A')) d),
  array['B'], 'fuzzy match on price ±2%, area ±1, district');

-- Another user outside the hunt sees no duplicates (RLS applies).
select set_config('request.jwt.claims',
  '{"sub":"22222222-0000-4000-a000-000000000002","role":"authenticated"}', true);
select is_empty($$ select * from public.listing_possible_duplicates(
  (select id from public.listings limit 1)) $$, 'non-member sees nothing');

select * from finish();
rollback;
