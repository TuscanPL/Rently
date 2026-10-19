-- Milestone 3: swipe deck order, reveal rule, matches and reconsider requests.
begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

-- Fixtures (as superuser) ------------------------------------------------------
insert into public.signup_allowlist (entry) values ('@test.local') on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-0000-4000-a000-00000000000a', 'ala3@test.local', '{"full_name":"Ala"}'),
  ('33333333-0000-4000-a000-00000000000b', 'bartek3@test.local', '{"full_name":"Bartek"}'),
  ('33333333-0000-4000-a000-00000000000c', 'stranger3@test.local', '{"full_name":"Cezary"}');

insert into public.hunts (id, name, created_by) values
  ('33333333-0000-4000-b000-000000000001', 'Deciding hunt',
   '33333333-0000-4000-a000-00000000000a');
insert into public.hunt_members (hunt_id, user_id, role, joined_at) values
  ('33333333-0000-4000-b000-000000000001', '33333333-0000-4000-a000-00000000000a', 'owner',
   now() - interval '1 day'),
  ('33333333-0000-4000-b000-000000000001', '33333333-0000-4000-a000-00000000000b', 'member',
   now());

-- L1 oldest … L4 newest; L5 is gone and never shows up in the deck.
insert into public.listings (id, hunt_id, added_by, title, rent, admin_fee, utilities_estimate,
                             status, created_at) values
  ('33333333-0000-4000-c000-000000000001', '33333333-0000-4000-b000-000000000001',
   '33333333-0000-4000-a000-00000000000a', 'L1', 3500, 500, 200, 'new', now() - interval '5 hours'),
  ('33333333-0000-4000-c000-000000000002', '33333333-0000-4000-b000-000000000001',
   '33333333-0000-4000-a000-00000000000a', 'L2', 4000, null, null, 'new', now() - interval '4 hours'),
  ('33333333-0000-4000-c000-000000000003', '33333333-0000-4000-b000-000000000001',
   '33333333-0000-4000-a000-00000000000a', 'L3', null, null, null, 'new', now() - interval '3 hours'),
  ('33333333-0000-4000-c000-000000000004', '33333333-0000-4000-b000-000000000001',
   '33333333-0000-4000-a000-00000000000a', 'L4', 3000, null, null, 'new', now() - interval '2 hours'),
  ('33333333-0000-4000-c000-000000000005', '33333333-0000-4000-b000-000000000001',
   '33333333-0000-4000-a000-00000000000a', 'L5', 3000, null, null, 'gone', now() - interval '1 hour');

create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

-- Deck titles in order, as the current user.
create function pg_temp.deck() returns text[] language sql as $$
  select array_agg(l.title order by d.ord)
  from public.next_deck_cards('33333333-0000-4000-b000-000000000001', 50)
       with ordinality d(listing_id, deck_group, reconsider_request_id, reconsider_note,
                         reconsider_requested_by, rejected_by, reconsider_pending, still_no, ord)
  join public.listings l on l.id = d.listing_id;
$$;

create function pg_temp.lid(p_title text) returns uuid language sql as $$
  select id from public.listings where title = p_title;
$$;

create function pg_temp.events(p_title text, p_type text) returns int language sql as $$
  select count(*)::int from public.listing_events e
  join public.listings l on l.id = e.listing_id
  where l.title = p_title and e.type = p_type;
$$;

-- Summary rows by title, for whoever is logged in (the function reads auth.uid()).
create temp view sm as
  select l.title, s.*
  from public.hunt_listing_summaries('33333333-0000-4000-b000-000000000001') s
  join public.listings l on l.id = s.listing_id;
grant select on sm to authenticated;

-- Deck order -------------------------------------------------------------------
select pg_temp.login('33333333-0000-4000-a000-00000000000b');
insert into public.votes (listing_id, swipe) values (pg_temp.lid('L2'), 'no');

select pg_temp.login('33333333-0000-4000-a000-00000000000a');
select is(pg_temp.deck(), array['L4', 'L3', 'L1', 'L2'],
          'unrejected newest first, then listings a partner rejected; gone listings skipped');
select is((select rejected_by from public.next_deck_cards('33333333-0000-4000-b000-000000000001', 10)
           where listing_id = pg_temp.lid('L2')), array['Bartek'], 'rejected card names who said no');
select is((select deck_group from public.next_deck_cards('33333333-0000-4000-b000-000000000001', 10)
           where listing_id = pg_temp.lid('L2')), 3, 'rejected card is group 3');
select is((select count(*)::int from public.next_deck_cards('33333333-0000-4000-b000-000000000001', 2)),
          2, 'limit is applied');

insert into public.votes (listing_id, swipe, stars) values (pg_temp.lid('L4'), 'yes', 5);
select is(pg_temp.deck(), array['L3', 'L1', 'L2'], 'voted listings leave the deck');

-- Votes are private; summaries expose them ---------------------------------------
select is((select count(*)::int from public.votes), 1, 'a member reads only their own votes');

select pg_temp.login('33333333-0000-4000-a000-00000000000b');
select is((select count(*)::int from public.votes), 1, 'partner reads only their own votes');
select is((select member_votes -> 0 ->> 'swipe' from sm where title = 'L4'), 'yes',
          'partner sees the swipe through the summary');

select is((select member_votes -> 0 -> 'stars' from sm where title = 'L4'), 'null'::jsonb,
          'stars stay hidden until everyone has voted');
select is((select votes_revealed from sm where title = 'L4'), false, 'not revealed yet');
select is((select combined_score from sm where title = 'L4'), null, 'no score before reveal');
select is((select total_monthly from sm where title = 'L1'), 4200::numeric,
          'total monthly = rent + admin fee + utilities');
select is((select total_monthly from sm where title = 'L3'), null, 'no total without rent');
select is((select criteria_violations from sm where title = 'L1'), '[]'::jsonb,
          'criteria violations are empty until milestone 4');

-- Match ------------------------------------------------------------------------
insert into public.votes (listing_id, swipe, stars) values (pg_temp.lid('L4'), 'yes', 2);
select is((select is_match from sm where title = 'L4'), true, 'both yes is a match');
select is((select votes_revealed from sm where title = 'L4'), true, 'revealed once everyone voted');
select is((select (member_votes -> 0 ->> 'stars')::int from sm where title = 'L4'), 5,
          'partner stars visible after reveal');
select is((select combined_score from sm where title = 'L4'), 4.5::numeric,
          'combined score = average stars + 1 for a match');
select is((select is_disagreement from sm where title = 'L4'), true,
          'star spread of 2 or more is a disagreement');
select is(pg_temp.events('L4', 'matched'), 1, 'the completing vote logs a matched event');
select is((select payload ->> 'completed_by' from public.listing_events e
           where e.listing_id = pg_temp.lid('L4') and e.type = 'matched'),
          '33333333-0000-4000-a000-00000000000b', 'matched event names who completed it');
select is((select count(*)::int from public.listing_events where payload ? 'stars'), 0,
          'events never carry star values');

update public.votes set stars = 3 where listing_id = pg_temp.lid('L4');
select is(pg_temp.events('L4', 'matched'), 1, 'changing stars does not re-log the match');
select is(pg_temp.events('L4', 'rated'), 1, 'a stars-only change logs rated');

-- Reveal toggle off: stars visible right away -----------------------------------
reset role;
update public.hunts set reveal_votes_after_both = false
  where id = '33333333-0000-4000-b000-000000000001';
select pg_temp.login('33333333-0000-4000-a000-00000000000a');
insert into public.votes (listing_id, swipe, stars) values (pg_temp.lid('L1'), 'maybe', 4);
select pg_temp.login('33333333-0000-4000-a000-00000000000b');
select is((select (member_votes -> 0 ->> 'stars')::int from sm where title = 'L1'), 4,
          'with the reveal toggle off, stars show before everyone votes');
select is((select is_maybe from sm where title = 'L1'), true, 'a maybe swipe is a maybe');
reset role;
update public.hunts set reveal_votes_after_both = true
  where id = '33333333-0000-4000-b000-000000000001';

-- Reconsider someone else's no ---------------------------------------------------
select pg_temp.login('33333333-0000-4000-a000-00000000000a');
insert into public.votes (listing_id, swipe) values (pg_temp.lid('L2'), 'yes');
select is((select is_disagreement from sm where title = 'L2'), true, 'yes vs no is a disagreement');

select is(public.request_reconsider(pg_temp.lid('L2'), '  price dropped  '),
          jsonb_build_object('cleared_own', false,
                             'requested', jsonb_build_array('33333333-0000-4000-a000-00000000000b'),
                             'already_open', '[]'::jsonb),
          'request goes to the member who said no');
select is(public.request_reconsider(pg_temp.lid('L2'), 'again') -> 'already_open',
          jsonb_build_array('33333333-0000-4000-a000-00000000000b'),
          'a second request while one is open is skipped, not an error');
select is((select count(*)::int from public.reconsider_requests), 1, 'only one open request');
select is(pg_temp.events('L2', 'reconsider_requested'), 1, 'request is logged once');
select is((select reconsider_pending from sm where title = 'L2'), true, 'summary shows it pending');

select pg_temp.login('33333333-0000-4000-a000-00000000000b');
select is(pg_temp.deck(), array['L2', 'L3', 'L1'], 'the request pins the listing to the top');
select results_eq(
  $$ select deck_group, reconsider_note, reconsider_requested_by
     from public.next_deck_cards('33333333-0000-4000-b000-000000000001', 1) $$,
  $$ values (1, 'price dropped', 'Ala') $$,
  'the pinned card shows the note and who asked');

-- Still no
update public.votes set swipe = 'no' where listing_id = pg_temp.lid('L2');
select is((select outcome::text from public.reconsider_requests), 'no', 'swiping again resolves it');
select is(pg_temp.events('L2', 'reconsider_resolved'), 1, 'resolution is logged');
select is(pg_temp.deck(), array['L3', 'L1'], 'still no: the listing leaves the deck again');
select is((select still_no from sm where title = 'L2'), true, 'summary flags still no');

-- Ask again, and this time it's a yes
select pg_temp.login('33333333-0000-4000-a000-00000000000a');
select is(public.request_reconsider(pg_temp.lid('L2')) -> 'requested',
          jsonb_build_array('33333333-0000-4000-a000-00000000000b'),
          'a new request is allowed once the last one is answered');
select pg_temp.login('33333333-0000-4000-a000-00000000000b');
update public.votes set swipe = 'yes' where listing_id = pg_temp.lid('L2');
select is((select is_match from sm where title = 'L2'), true, 'reconsidered listing becomes a match');
select is(pg_temp.events('L2', 'matched'), 1, 'and the match is logged');
select is((select still_no from sm where title = 'L2'), false, 'no longer still no');

-- Reconsider your own no ---------------------------------------------------------
insert into public.votes (listing_id, swipe) values (pg_temp.lid('L3'), 'no');
select is(public.request_reconsider(pg_temp.lid('L3'), null) -> 'cleared_own', 'true'::jsonb,
          'own no is cleared');
select is((select count(*)::int from public.votes where listing_id = pg_temp.lid('L3')), 0,
          'the vote is gone');
select is(pg_temp.deck(), array['L3', 'L1'], 'and the listing is back in the deck');
select is(pg_temp.events('L3', 'reconsidered'), 1, 'logged as reconsidered');

-- Non-members --------------------------------------------------------------------
select pg_temp.login('33333333-0000-4000-a000-00000000000c');
select throws_ok($$ select * from public.next_deck_cards('33333333-0000-4000-b000-000000000001', 10) $$,
                 '42501', null, 'stranger: no deck');
select throws_ok($$ select * from public.hunt_listing_summaries('33333333-0000-4000-b000-000000000001') $$,
                 '42501', null, 'stranger: no summaries');
select throws_ok($$ select public.request_reconsider('33333333-0000-4000-c000-000000000001', 'x') $$,
                 '42501', null, 'stranger: cannot request reconsider');
select is_empty('select * from public.reconsider_requests', 'stranger: no reconsider requests');

select * from finish();
rollback;
