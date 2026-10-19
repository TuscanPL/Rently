-- RLS: a non-member can't read or write anything in another hunt.
-- Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- Fixtures (as superuser) ------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-0000-4000-a000-000000000001', 'owner@test.local', '{"full_name":"Owner"}'),
  ('11111111-0000-4000-a000-000000000002', 'partner@test.local', '{}'),
  ('11111111-0000-4000-a000-000000000003', 'stranger@test.local', '{}');

select is((select display_name from public.profiles
           where id = '11111111-0000-4000-a000-000000000002'),
          'partner', 'profile created from auth user, name falls back to email');

create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

-- Owner creates a hunt and an invite --------------------------------------------
select pg_temp.login('11111111-0000-4000-a000-000000000001');
create temp table ctx as select (public.create_hunt('Test hunt')).id as hunt_id;
grant select on ctx to authenticated;

select is((select role::text from public.hunt_members
           where hunt_id = (select hunt_id from ctx)), 'owner', 'creator becomes owner');

insert into public.hunt_invites (hunt_id, token)
  values ((select hunt_id from ctx), 'tok-partner');
insert into public.hunt_invites (hunt_id, token, expires_at)
  values ((select hunt_id from ctx), 'tok-expired', now() - interval '1 minute');
insert into public.pins (hunt_id, label, lat, lng)
  values ((select hunt_id from ctx), 'Office', 52.2, 21.0);
insert into public.listings (hunt_id, title, canonical_url, rent)
  values ((select hunt_id from ctx), 'Nice flat', 'https://example.com/1', 3500);
create temp table lctx as select id as listing_id from public.listings;
grant select on lctx to authenticated;
insert into public.votes (listing_id, swipe) values ((select listing_id from lctx), 'yes');
insert into public.comments (listing_id, body) values ((select listing_id from lctx), 'hi');
insert into public.listing_events (listing_id, type) values ((select listing_id from lctx), 'added');
insert into public.listing_photos (listing_id, original_url)
  values ((select listing_id from lctx), 'https://example.com/1.jpg');

select throws_ok(
  $$ insert into public.listings (hunt_id, title, added_by)
     values ((select hunt_id from ctx), 'spoofed', '11111111-0000-4000-a000-000000000002') $$,
  '42501', null, 'cannot add a listing on behalf of someone else');

-- Stranger sees nothing and can write nothing ----------------------------------
select pg_temp.login('11111111-0000-4000-a000-000000000003');

select is_empty('select * from public.hunts', 'stranger: no hunts');
select is_empty('select * from public.hunt_members', 'stranger: no members');
select is_empty('select * from public.hunt_invites', 'stranger: no invites');
select is_empty('select * from public.pins', 'stranger: no pins');
select is_empty('select * from public.listings', 'stranger: no listings');
select is_empty('select * from public.listing_photos', 'stranger: no photos');
select is_empty('select * from public.votes', 'stranger: no votes');
select is_empty('select * from public.comments', 'stranger: no comments');
select is_empty('select * from public.listing_events', 'stranger: no events');
select is_empty($$ select * from public.profiles
                   where id <> '11111111-0000-4000-a000-000000000003' $$,
                'stranger: no other profiles');

select throws_ok(
  $$ insert into public.listings (hunt_id, title) values ((select hunt_id from ctx), 'x') $$,
  '42501', null, 'stranger: cannot add listing');
select throws_ok(
  $$ insert into public.pins (hunt_id, label, lat, lng) values ((select hunt_id from ctx), 'x', 0, 0) $$,
  '42501', null, 'stranger: cannot add pin');
select throws_ok(
  $$ insert into public.votes (listing_id, swipe) values ((select listing_id from lctx), 'no') $$,
  '42501', null, 'stranger: cannot vote');
select throws_ok(
  $$ insert into public.comments (listing_id, body) values ((select listing_id from lctx), 'x') $$,
  '42501', null, 'stranger: cannot comment');
select throws_ok(
  $$ insert into public.hunt_invites (hunt_id) values ((select hunt_id from ctx)) $$,
  '42501', null, 'stranger: cannot create invite');
select throws_ok(
  $$ insert into public.hunt_members (hunt_id, user_id)
     values ((select hunt_id from ctx), '11111111-0000-4000-a000-000000000003') $$,
  '42501', null, 'stranger: cannot add themselves as member');

update public.listings set title = 'hacked';
update public.hunts set name = 'hacked';
delete from public.listings;
delete from public.votes;
select pg_temp.login('11111111-0000-4000-a000-000000000001');
select is((select title from public.listings), 'Nice flat', 'stranger update/delete had no effect');
select is((select count(*)::int from public.votes), 1, 'stranger could not delete votes');

-- Invites ----------------------------------------------------------------------
select pg_temp.login('11111111-0000-4000-a000-000000000003');
select throws_ok($$ select public.redeem_invite('tok-expired') $$, 'P0001', 'invite expired',
                 'expired invite rejected');
select throws_ok($$ select public.redeem_invite('nope') $$, 'P0002', 'invite not found',
                 'unknown invite rejected');
select is((select hunt_name from public.invite_preview('tok-partner')), 'Test hunt',
          'invite preview shows hunt name to non-member');

select pg_temp.login('11111111-0000-4000-a000-000000000002');
select is(public.redeem_invite('tok-partner'), (select hunt_id from ctx), 'partner joins');
select is((select count(*)::int from public.listings), 1, 'partner now sees listings');
select is((select display_name from public.profiles
           where id = '11111111-0000-4000-a000-000000000001'), 'Owner',
          'partner sees co-member profile');

select pg_temp.login('11111111-0000-4000-a000-000000000003');
select throws_ok($$ select public.redeem_invite('tok-partner') $$, 'P0001',
                 'invite already used', 'used invite cannot be redeemed twice');

-- Members cannot edit each other's votes ---------------------------------------
select pg_temp.login('11111111-0000-4000-a000-000000000002');
update public.votes set swipe = 'no';
select pg_temp.login('11111111-0000-4000-a000-000000000001');
select is((select swipe::text from public.votes), 'yes', 'member cannot change partner vote');

-- Non-owner member cannot change hunt settings ---------------------------------
select pg_temp.login('11111111-0000-4000-a000-000000000002');
update public.hunts set name = 'renamed';
select pg_temp.login('11111111-0000-4000-a000-000000000001');
select is((select name from public.hunts), 'Test hunt', 'member cannot rename hunt');

-- Anonymous gets nothing -------------------------------------------------------
reset role;
set local role anon;
select is_empty('select * from public.listings', 'anon: no listings');

select * from finish();
rollback;
