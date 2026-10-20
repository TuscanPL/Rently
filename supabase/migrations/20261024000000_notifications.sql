-- Milestone 6: notifications (in-app feed + Web Push).
--
-- Every notification starts as a listing_events row. A trigger turns the events
-- below into one `notifications` row per recipient (the in-app feed) and asks the
-- `send-push` edge function to deliver them as Web Push:
--
--   event type            kind                recipients
--   added                 listing_added       members except the adder
--   matched               match               members except the one who completed it
--   reconsider_requested  reconsider_request  payload.target_user only
--   status_changed        status_changed      members except the actor     (milestone 4)
--   price_changed         price_dropped       all members, only when rent + admin fee went down (milestone 8)
--   ad_removed            ad_removed          all members                  (milestone 8)
--
-- The actor (listing_events.user_id) is never notified about their own action.
-- Events written by the service role have no actor, so everyone gets those.
-- Each user can switch a kind off in notification_prefs; that drops it from both
-- the feed and push.
--
-- Push delivery: the trigger calls send-push with pg_net. The function URL and
-- a shared secret come from Supabase Vault (secrets `send_push_url` and
-- `push_webhook_secret`, see the README). Without them the feed still works and
-- nothing is sent.

create extension if not exists pg_net with schema extensions;

-- Mirrored in packages/shared/src/enums.ts (NOTIFICATION_KINDS).
create type public.notification_kind as enum (
  'match', 'listing_added', 'reconsider_request', 'status_changed', 'ad_removed', 'price_dropped'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
-- One row per browser/device that agreed to receive push. The endpoint is the
-- push service URL for that browser, so it is unique across users.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 2000),
  p256dh text not null check (length(p256dh) between 1 and 200),
  auth text not null check (length(auth) between 1 and 100),
  user_agent text check (length(user_agent) <= 500),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- One row per user; a missing row means everything is on.
create table public.notification_prefs (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  match boolean not null default true,
  listing_added boolean not null default true,
  reconsider_request boolean not null default true,
  status_changed boolean not null default true,
  ad_removed boolean not null default true,
  price_dropped boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  hunt_id uuid not null references public.hunts (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete cascade,
  event_id uuid references public.listing_events (id) on delete set null,
  kind public.notification_kind not null,
  -- Snapshot for the text: actor_name, listing_title, plus kind-specific fields
  -- (note; from/to; total_before/total_after).
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create trigger notification_prefs_touch before update on public.notification_prefs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security: each user sees and manages only their own rows
-- ---------------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.notifications enable row level security;

create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());
create policy push_subscriptions_update on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

create policy notification_prefs_select on public.notification_prefs for select to authenticated
  using (user_id = auth.uid());
create policy notification_prefs_insert on public.notification_prefs for insert to authenticated
  with check (user_id = auth.uid());
create policy notification_prefs_update on public.notification_prefs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The trigger writes notifications; users read them, mark them read and delete them.
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());
revoke insert, update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Saving a push subscription
-- ---------------------------------------------------------------------------
-- Upserts by endpoint. If another account subscribed this browser before (say,
-- someone else signed in on this phone earlier), the device moves to the caller:
-- only the browser that holds the subscription knows its endpoint and keys.
create function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 500))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        created_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- listing_events → notifications (+ push)
-- ---------------------------------------------------------------------------
-- Reads a Vault secret by name; null when Vault or the secret is missing.
create function public.read_vault_secret(p_name text)
returns text
language plpgsql stable security definer set search_path = ''
as $$
begin
  return (select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1);
exception when others then
  return null;
end;
$$;
revoke execute on function public.read_vault_secret(text) from public, anon, authenticated;

create function public.notify_listing_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_kind public.notification_kind;
  v_listing public.listings;
  v_target uuid;
  v_payload jsonb;
  v_before numeric;
  v_after numeric;
  v_ids uuid[];
  v_url text;
  v_secret text;
begin
  v_kind := case new.type
    when 'added' then 'listing_added'
    when 'matched' then 'match'
    when 'reconsider_requested' then 'reconsider_request'
    when 'status_changed' then 'status_changed'
    when 'price_changed' then 'price_dropped'
    when 'ad_removed' then 'ad_removed'
  end::public.notification_kind;
  if v_kind is null then
    return null;
  end if;

  select * into v_listing from public.listings where id = new.listing_id;
  if not found then
    return null;
  end if;

  v_payload := jsonb_build_object(
    'listing_title', v_listing.title,
    'actor_name', (select display_name from public.profiles where id = new.user_id)
  );

  if v_kind = 'reconsider_request' then
    v_target := (new.payload ->> 'target_user')::uuid;
    if v_target is null then
      return null;
    end if;
    v_payload := v_payload || jsonb_build_object('note', new.payload -> 'note');
  elsif v_kind = 'status_changed' then
    v_payload := v_payload || jsonb_build_object('from', new.payload -> 'from',
                                                 'to', new.payload -> 'to');
  elsif v_kind = 'price_dropped' then
    -- Only a lower total (rent + admin fee) is news worth a notification.
    v_before := (new.payload ->> 'rent_before')::numeric
                + coalesce((new.payload ->> 'admin_fee_before')::numeric, 0);
    v_after := (new.payload ->> 'rent_after')::numeric
               + coalesce((new.payload ->> 'admin_fee_after')::numeric, 0);
    if v_before is null or v_after is null or v_after >= v_before then
      return null;
    end if;
    v_payload := v_payload || jsonb_build_object('total_before', v_before,
                                                 'total_after', v_after);
  end if;

  with inserted as (
    insert into public.notifications (user_id, hunt_id, listing_id, event_id, kind, payload)
    select m.user_id, v_listing.hunt_id, v_listing.id, new.id, v_kind, v_payload
    from public.hunt_members m
    left join public.notification_prefs p on p.user_id = m.user_id
    where m.hunt_id = v_listing.hunt_id
      and m.user_id is distinct from new.user_id
      and (v_target is null or m.user_id = v_target)
      and coalesce(case v_kind
            when 'match' then p.match
            when 'listing_added' then p.listing_added
            when 'reconsider_request' then p.reconsider_request
            when 'status_changed' then p.status_changed
            when 'ad_removed' then p.ad_removed
            when 'price_dropped' then p.price_dropped
          end, true)
    returning id
  )
  select array_agg(id) into v_ids from inserted;

  if v_ids is null then
    return null;
  end if;

  -- Push is best effort: no secrets, or a failing pg_net, leaves just the feed.
  v_url := public.read_vault_secret('send_push_url');
  v_secret := public.read_vault_secret('push_webhook_secret');
  if v_url is not null and v_secret is not null then
    begin
      perform net.http_post(
        url := v_url,
        body := jsonb_build_object('notification_ids', to_jsonb(v_ids)),
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-push-secret', v_secret),
        timeout_milliseconds := 10000
      );
    exception when others then
      raise warning 'send-push request failed: %', sqlerrm;
    end;
  end if;

  return null;
exception when others then
  -- Never let a notification problem undo the event (and the action behind it).
  raise warning 'notify_listing_event failed: %', sqlerrm;
  return null;
end;
$$;

revoke execute on function public.notify_listing_event() from public, anon, authenticated;

create trigger listing_events_notify
  after insert on public.listing_events
  for each row execute function public.notify_listing_event();

-- ---------------------------------------------------------------------------
-- Realtime: the feed updates live
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.notifications;
