-- Local development seed (runs on `supabase db reset`, never on `db push`).
-- Two users share the example hunt. Sign in with either address via magic link;
-- the email lands in Mailpit at http://127.0.0.1:54324.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-00000000000a',
   'authenticated', 'authenticated', 'ala@example.com', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Ala"}', now(), now(),
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-00000000000b',
   'authenticated', 'authenticated', 'bartek@example.com', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Bartek"}', now(), now(),
   '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                             last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.id in ('00000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-00000000000b');

-- Example hunt: Warsaw, 3 rooms, near SKM Służewiec or a station on the same
-- line (S2/S3), private landlords only. Pin coordinates are approximate.
insert into public.hunts (id, name, city, created_by, criteria) values
  ('00000000-0000-4000-b000-000000000001', 'Warsaw flat 2026', 'Warszawa',
   '00000000-0000-4000-a000-00000000000a',
   jsonb_build_object(
     'minRooms', 3,
     'privateOnly', true,
     'maxDistanceKm', 1.5,
     'distancePinId', '00000000-0000-4000-c000-000000000001',
     'notes', 'Close to SKM Służewiec or another station on the S2/S3 line'
   ));

insert into public.hunt_members (hunt_id, user_id, role) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-00000000000a', 'owner'),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-00000000000b', 'member');

insert into public.pins (id, hunt_id, label, lat, lng, kind) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-b000-000000000001',
   'SKM Służewiec', 52.1808, 20.9997, 'station'),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-b000-000000000001',
   'SKM Rakowiec', 52.2003, 20.9775, 'station'),
  ('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-b000-000000000001',
   'SKM Warszawa Zachodnia', 52.2196, 20.9654, 'station');
