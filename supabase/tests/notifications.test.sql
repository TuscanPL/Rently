-- Milestone 6: listing_events → notifications (recipients, prefs), RLS on the
-- notification tables, and the push request to send-push via pg_net.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- Fixtures (as superuser) ------------------------------------------------------
insert into public.signup_allowlist (entry) values ('@test.local') on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data) values
  ('66666666-0000-4000-a000-00000000000a', 'ala6@test.local', '{"full_name":"Ala"}'),
  ('66666666-0000-4000-a000-00000000000b', 'bartek6@test.local', '{"full_name":"Bartek"}'),
  ('66666666-0000-4000-a000-00000000000c', 'cezary6@test.local', '{"full_name":"Cezary"}'),
  ('66666666-0000-4000-a000-00000000000d', 'outsider6@test.local', '{"full_name":"Dorota"}');

insert into public.hunts (id, name, created_by) values
  ('66666666-0000-4000-b000-000000000001', 'Notify hunt', '66666666-0000-4000-a000-00000000000a');
insert into public.hunt_members (hunt_id, user_id, role) values
  ('66666666-0000-4000-b000-000000000001', '66666666-0000-4000-a000-00000000000a', 'owner'),
  ('66666666-0000-4000-b000-000000000001', '66666666-0000-4000-a000-00000000000b', 'member'),
  ('66666666-0000-4000-b000-000000000001', '66666666-0000-4000-a000-00000000000c', 'member');
insert into public.listings (id, hunt_id, added_by, title) values
  ('66666666-0000-4000-c000-000000000001', '66666666-0000-4000-b000-000000000001',
   '66666666-0000-4000-a000-00000000000a', 'Notify flat');

create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

create function pg_temp.event(p_user uuid, p_type text, p_payload jsonb default '{}')
returns void language sql as $$
  insert into public.listing_events (listing_id, user_id, type, payload)
  values ('66666666-0000-4000-c000-000000000001', p_user, p_type,
          p_payload || '{"hunt_id": "66666666-0000-4000-b000-000000000001"}');
$$;

-- Recipients of the hunt's notifications of a kind, by display name. Takes them
-- out of the table (as superuser) so the next check starts from a clean slate.
create function pg_temp.take(p_kind text) returns text[] language plpgsql as $$
declare
  v_names text[];
begin
  with taken as (
    delete from public.notifications
    where hunt_id = '66666666-0000-4000-b000-000000000001' and kind::text = p_kind
    returning user_id
  )
  select coalesce(array_agg(p.display_name order by p.display_name), '{}') into v_names
  from taken t join public.profiles p on p.id = t.user_id;
  return v_names;
end;
$$;

create function pg_temp.payload(p_kind text) returns jsonb language sql as $$
  select payload from public.notifications
  where hunt_id = '66666666-0000-4000-b000-000000000001' and kind::text = p_kind
  limit 1;
$$;

create function pg_temp.pending() returns int language sql as $$
  select count(*)::int from public.notifications
  where hunt_id = '66666666-0000-4000-b000-000000000001';
$$;

create function pg_temp.queued() returns int language sql as $$
  select count(*)::int from net.http_request_queue
  where url = (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_url');
$$;

-- Event mapping and recipients ---------------------------------------------------
select pg_temp.event('66666666-0000-4000-a000-00000000000a', 'added');
select is(pg_temp.payload('listing_added'),
  '{"actor_name": "Ala", "listing_title": "Notify flat"}'::jsonb,
  'the payload snapshots the actor and the listing title');
select is(pg_temp.take('listing_added'), array['Bartek', 'Cezary'],
  'added: every member except the adder');

select pg_temp.event('66666666-0000-4000-a000-00000000000b', 'matched',
  '{"completed_by": "66666666-0000-4000-a000-00000000000b"}');
select is(pg_temp.take('match'), array['Ala', 'Cezary'],
  'matched: everyone except the member whose vote completed it');

select pg_temp.event('66666666-0000-4000-a000-00000000000c', 'status_changed',
  '{"from": "new", "to": "viewing_booked"}');
select is(pg_temp.payload('status_changed') ->> 'to', 'viewing_booked',
  'status_changed keeps the new status');
select is(pg_temp.take('status_changed'), array['Ala', 'Bartek'],
  'status_changed: everyone except the actor');

select pg_temp.event(null, 'ad_removed');
select is(pg_temp.take('ad_removed'), array['Ala', 'Bartek', 'Cezary'],
  'ad_removed from the service role (no actor): everyone');

select pg_temp.event(null, 'price_changed',
  '{"rent_before": 4000, "rent_after": 4200, "admin_fee_before": 600, "admin_fee_after": 300}');
select is(pg_temp.payload('price_dropped') - 'listing_title' - 'actor_name',
  '{"total_before": 4600, "total_after": 4500}'::jsonb, 'price_dropped carries the totals');
select is(pg_temp.take('price_dropped'), array['Ala', 'Bartek', 'Cezary'],
  'price_changed with a lower total: everyone gets price_dropped');

select pg_temp.event(null, 'price_changed',
  '{"rent_before": 4000, "rent_after": 4100, "admin_fee_before": null, "admin_fee_after": null}');
select pg_temp.event(null, 'price_changed',
  '{"rent_before": null, "rent_after": 4100}');
select is(pg_temp.pending(), 0,
  'a price rise or an unknown old price notifies nobody');

select pg_temp.event('66666666-0000-4000-a000-00000000000a', 'voted', '{"swipe": "yes"}');
select pg_temp.event('66666666-0000-4000-a000-00000000000a', 'rated');
select is(pg_temp.pending(), 0,
  'other event types make no notifications');

-- Reconsider: only the member it is aimed at -------------------------------------
insert into public.votes (listing_id, user_id, swipe) values
  ('66666666-0000-4000-c000-000000000001', '66666666-0000-4000-a000-00000000000b', 'no'),
  ('66666666-0000-4000-c000-000000000001', '66666666-0000-4000-a000-00000000000c', 'yes');
select pg_temp.login('66666666-0000-4000-a000-00000000000a');
select public.request_reconsider('66666666-0000-4000-c000-000000000001', 'Balcony!');
reset role;
select is(pg_temp.payload('reconsider_request') ->> 'note', 'Balcony!',
  'the reconsider note is in the payload');
select is(pg_temp.take('reconsider_request'), array['Bartek'],
  'reconsider_requested: only the target');
select pg_temp.event('66666666-0000-4000-a000-00000000000a', 'reconsider_requested',
  '{"target_user": "66666666-0000-4000-a000-00000000000a"}');
select is(pg_temp.pending(), 0,
  'a request aimed at the actor themself notifies nobody');

-- Preferences --------------------------------------------------------------------
insert into public.notification_prefs (user_id, listing_added)
values ('66666666-0000-4000-a000-00000000000c', false);
select pg_temp.event('66666666-0000-4000-a000-00000000000a', 'added');
select is(pg_temp.take('listing_added'), array['Bartek'],
  'a member who switched a kind off gets no notification of that kind');
select pg_temp.event(null, 'ad_removed');
select is(pg_temp.take('ad_removed'), array['Ala', 'Bartek', 'Cezary'],
  'their other kinds still arrive');

-- Push request via pg_net --------------------------------------------------------
select ok(pg_temp.queued() > 0, 'with the Vault secrets set, new notifications are posted to send-push');
select is((select headers ->> 'x-push-secret' from net.http_request_queue order by id desc limit 1),
  (select decrypted_secret from vault.decrypted_secrets where name = 'push_webhook_secret'),
  'the request carries the shared secret');

create temp table queue_size as select count(*)::int as n from net.http_request_queue;
select pg_temp.event('66666666-0000-4000-a000-00000000000a', 'voted', '{"swipe": "no"}');
select is((select count(*)::int from net.http_request_queue), (select n from queue_size),
  'no request when nobody is notified');

delete from vault.secrets where name in ('send_push_url', 'push_webhook_secret');
select lives_ok($$ select pg_temp.event(null, 'ad_removed') $$,
  'events still insert without the Vault secrets');
select is(pg_temp.pending(), 3, 'and the feed rows are still written');
select is((select count(*)::int from net.http_request_queue), (select n from queue_size),
  'but nothing is sent');

-- RLS: notifications --------------------------------------------------------------
select pg_temp.login('66666666-0000-4000-a000-00000000000b');
select ok((select count(*) > 0 from public.notifications), 'Bartek sees his notifications');
select is((select count(*)::int from public.notifications
           where user_id <> '66666666-0000-4000-a000-00000000000b'), 0,
  'and nobody else''s');
select lives_ok($$ update public.notifications set read_at = now() $$,
  'Bartek can mark his notifications read');
select is((select count(*)::int from public.notifications where read_at is null), 0,
  'all of his are read now');
select throws_ok($$ update public.notifications set kind = 'match' $$, '42501', null,
  'he cannot change anything else');
select throws_ok(
  $$ insert into public.notifications (user_id, hunt_id, kind)
     values ('66666666-0000-4000-a000-00000000000a', '66666666-0000-4000-b000-000000000001', 'match') $$,
  '42501', null, 'users cannot write notifications');
reset role;
select is((select count(*)::int from public.notifications
           where user_id = '66666666-0000-4000-a000-00000000000a' and read_at is not null), 0,
  'Ala''s notifications were untouched');

select pg_temp.login('66666666-0000-4000-a000-00000000000d');
select is((select count(*)::int from public.notifications), 0, 'outsiders see none');
reset role;

-- RLS: push_subscriptions --------------------------------------------------------
select pg_temp.login('66666666-0000-4000-a000-00000000000a');
select lives_ok(
  $$ select public.save_push_subscription('https://push.example.net/ala-phone', 'p256', 'auth', 'Pixel') $$,
  'Ala saves a subscription');
select is((select count(*)::int from public.push_subscriptions), 1, 'and sees it');
select pg_temp.login('66666666-0000-4000-a000-00000000000b');
select is((select count(*)::int from public.push_subscriptions), 0,
  'Bartek cannot see Ala''s subscriptions');
select throws_ok(
  $$ insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
     values ('66666666-0000-4000-a000-00000000000a', 'https://push.example.net/x', 'p', 'a') $$,
  '42501', null, 'nor add one for her');
-- Bartek signs in on the same phone: the device moves to him.
select public.save_push_subscription('https://push.example.net/ala-phone', 'p256-2', 'auth-2', 'Pixel');
select is((select count(*)::int from public.push_subscriptions), 1,
  'saving a known endpoint moves the device to the caller');
reset role;
select is((select user_id from public.push_subscriptions
           where endpoint = 'https://push.example.net/ala-phone'),
  '66666666-0000-4000-a000-00000000000b'::uuid, 'one row per endpoint');

-- RLS: notification_prefs --------------------------------------------------------
select pg_temp.login('66666666-0000-4000-a000-00000000000b');
select lives_ok($$ insert into public.notification_prefs (match) values (false) $$,
  'Bartek saves his own preferences');
select is((select count(*)::int from public.notification_prefs), 1,
  'and sees only his own row');
select throws_ok(
  $$ insert into public.notification_prefs (user_id) values ('66666666-0000-4000-a000-00000000000a') $$,
  '42501', null, 'nobody writes someone else''s preferences');

select * from finish();
rollback;
