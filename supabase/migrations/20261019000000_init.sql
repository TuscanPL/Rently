-- ApartmentTogether: initial schema.
-- Every table lives in a hunt (directly or via a listing) and RLS limits access
-- to hunt members. Membership changes only go through security-definer RPCs.

-- ---------------------------------------------------------------------------
-- Enums (mirrored in packages/shared/src/enums.ts)
-- ---------------------------------------------------------------------------
create type public.hunt_role as enum ('owner', 'member');
create type public.pin_kind as enum ('work', 'station', 'family', 'other');
create type public.listing_source as enum (
  'otodom', 'olx', 'gratka', 'morizon', 'nieruchomosci_online', 'domiporta', 'facebook', 'other'
);
create type public.advertiser_type as enum ('private', 'agency', 'unknown');
create type public.listing_status as enum (
  'new', 'contacted', 'viewing_booked', 'viewed', 'applied', 'won', 'rejected', 'gone'
);
create type public.swipe as enum ('yes', 'maybe', 'no');
create type public.comment_kind as enum ('comment', 'viewing_note');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.hunts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  city text not null default 'Warszawa',
  created_by uuid not null references public.profiles (id),
  criteria jsonb not null default '{}'::jsonb,
  reveal_votes_after_both boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.hunt_members (
  hunt_id uuid not null references public.hunts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.hunt_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (hunt_id, user_id)
);
create index hunt_members_user_idx on public.hunt_members (user_id);

create table public.hunt_invites (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references public.hunts (id) on delete cascade,
  -- 64 hex chars from two v4 UUIDs: ~244 random bits.
  token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_by uuid not null default auth.uid() references public.profiles (id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references public.profiles (id),
  used_at timestamptz
);
create index hunt_invites_hunt_idx on public.hunt_invites (hunt_id);

create table public.pins (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references public.hunts (id) on delete cascade,
  label text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  kind public.pin_kind not null default 'other'
);
create index pins_hunt_idx on public.pins (hunt_id);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references public.hunts (id) on delete cascade,
  added_by uuid default auth.uid() references public.profiles (id) on delete set null,
  source public.listing_source not null default 'other',
  url text,
  canonical_url text,
  title text,
  description text,
  rent numeric(10, 2),
  admin_fee numeric(10, 2),
  utilities_estimate numeric(10, 2),
  deposit numeric(10, 2),
  area_m2 numeric(7, 2),
  rooms int,
  floor int,
  total_floors int,
  address text,
  district text,
  lat double precision,
  lng double precision,
  available_from date,
  advertiser_type public.advertiser_type not null default 'unknown',
  features jsonb not null default '{}'::jsonb,
  raw jsonb,
  parse_confidence real,
  needs_details boolean not null default false,
  status public.listing_status not null default 'new',
  viewing_at timestamptz,
  is_active boolean not null default true,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hunt_id, canonical_url)
);
create index listings_hunt_created_idx on public.listings (hunt_id, created_at desc);
create index listings_active_checked_idx on public.listings (last_checked_at) where is_active;

create table public.listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  original_url text,
  storage_path text,
  is_cover boolean not null default false,
  broken boolean not null default false,
  position int not null default 0,
  check (original_url is not null or storage_path is not null)
);
create index listing_photos_listing_idx on public.listing_photos (listing_id, position);

create table public.listing_price_history (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  rent numeric(10, 2),
  admin_fee numeric(10, 2),
  observed_at timestamptz not null default now()
);
create index listing_price_history_listing_idx
  on public.listing_price_history (listing_id, observed_at);

create table public.votes (
  listing_id uuid not null references public.listings (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  swipe public.swipe not null,
  stars smallint check (stars between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);
create index votes_user_idx on public.votes (user_id);

create table public.reconsider_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  target_user uuid not null references public.profiles (id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  outcome public.swipe
);
create unique index reconsider_requests_one_open
  on public.reconsider_requests (listing_id, target_user) where resolved_at is null;

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null default '',
  photo_paths text[] not null default '{}',
  kind public.comment_kind not null default 'comment',
  created_at timestamptz not null default now()
);
create index comments_listing_idx on public.comments (listing_id, created_at);

create table public.listing_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles (id) on delete set null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index listing_events_listing_idx on public.listing_events (listing_id, created_at);

-- ---------------------------------------------------------------------------
-- Membership helpers (security definer so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------
create function public.is_hunt_member(p_hunt_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.hunt_members
    where hunt_id = p_hunt_id and user_id = auth.uid()
  );
$$;

create function public.is_hunt_owner(p_hunt_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.hunt_members
    where hunt_id = p_hunt_id and user_id = auth.uid() and role = 'owner'
  );
$$;

create function public.is_listing_member(p_listing_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.listings l
    join public.hunt_members m on m.hunt_id = l.hunt_id
    where l.id = p_listing_id and m.user_id = auth.uid()
  );
$$;

create function public.shares_hunt_with(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.hunt_members a
    join public.hunt_members b on b.hunt_id = a.hunt_id
    where a.user_id = auth.uid() and b.user_id = p_user_id
  );
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger listings_touch before update on public.listings
  for each row execute function public.touch_updated_at();
create trigger votes_touch before update on public.votes
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create function public.create_hunt(
  p_name text,
  p_city text default 'Warszawa',
  p_criteria jsonb default '{}'::jsonb
)
returns public.hunts
language plpgsql security definer set search_path = ''
as $$
declare
  v_hunt public.hunts;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.hunts (name, city, created_by, criteria)
  values (p_name, coalesce(nullif(trim(p_city), ''), 'Warszawa'), auth.uid(),
          coalesce(p_criteria, '{}'::jsonb))
  returning * into v_hunt;

  insert into public.hunt_members (hunt_id, user_id, role)
  values (v_hunt.id, auth.uid(), 'owner');

  return v_hunt;
end;
$$;

-- What a not-yet-member sees on the join page.
create function public.invite_preview(p_token text)
returns table (hunt_id uuid, hunt_name text, invited_by text, expires_at timestamptz,
               is_valid boolean, already_member boolean)
language sql stable security definer set search_path = ''
as $$
  select h.id, h.name, p.display_name, i.expires_at,
         i.used_at is null and i.expires_at > now(),
         exists (select 1 from public.hunt_members m
                 where m.hunt_id = h.id and m.user_id = auth.uid())
  from public.hunt_invites i
  join public.hunts h on h.id = i.hunt_id
  join public.profiles p on p.id = i.created_by
  where i.token = p_token;
$$;

-- Joins the caller to the invite's hunt. Invites are single-use; a caller who
-- is already a member gets the hunt id back without consuming the invite.
create function public.redeem_invite(p_token text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_invite public.hunt_invites;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_invite from public.hunt_invites where token = p_token for update;
  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.hunt_members
             where hunt_id = v_invite.hunt_id and user_id = auth.uid()) then
    return v_invite.hunt_id;
  end if;

  if v_invite.used_at is not null then
    raise exception 'invite already used' using errcode = 'P0001';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invite expired' using errcode = 'P0001';
  end if;

  insert into public.hunt_members (hunt_id, user_id, role)
  values (v_invite.hunt_id, auth.uid(), 'member');

  update public.hunt_invites
  set used_by = auth.uid(), used_at = now()
  where id = v_invite.id;

  return v_invite.hunt_id;
end;
$$;

revoke execute on function
  public.create_hunt(text, text, jsonb),
  public.invite_preview(text),
  public.redeem_invite(text),
  public.is_hunt_member(uuid),
  public.is_hunt_owner(uuid),
  public.is_listing_member(uuid),
  public.shares_hunt_with(uuid)
from public, anon;
grant execute on function
  public.create_hunt(text, text, jsonb),
  public.invite_preview(text),
  public.redeem_invite(text),
  public.is_hunt_member(uuid),
  public.is_hunt_owner(uuid),
  public.is_listing_member(uuid),
  public.shares_hunt_with(uuid)
to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.hunts enable row level security;
alter table public.hunt_members enable row level security;
alter table public.hunt_invites enable row level security;
alter table public.pins enable row level security;
alter table public.listings enable row level security;
alter table public.listing_photos enable row level security;
alter table public.listing_price_history enable row level security;
alter table public.votes enable row level security;
alter table public.reconsider_requests enable row level security;
alter table public.comments enable row level security;
alter table public.listing_events enable row level security;

-- profiles: yourself and people you share a hunt with
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_hunt_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- hunts: created through create_hunt(); owners edit and delete
create policy hunts_select on public.hunts for select to authenticated
  using (public.is_hunt_member(id));
create policy hunts_update on public.hunts for update to authenticated
  using (public.is_hunt_owner(id)) with check (public.is_hunt_owner(id));
create policy hunts_delete on public.hunts for delete to authenticated
  using (public.is_hunt_owner(id));

-- hunt_members: joined through RPCs; owners manage, anyone can leave
create policy hunt_members_select on public.hunt_members for select to authenticated
  using (public.is_hunt_member(hunt_id));
create policy hunt_members_update on public.hunt_members for update to authenticated
  using (public.is_hunt_owner(hunt_id)) with check (public.is_hunt_owner(hunt_id));
create policy hunt_members_delete on public.hunt_members for delete to authenticated
  using (user_id = auth.uid() or public.is_hunt_owner(hunt_id));

-- hunt_invites: members create, list and revoke; redeemed via redeem_invite()
create policy hunt_invites_select on public.hunt_invites for select to authenticated
  using (public.is_hunt_member(hunt_id));
create policy hunt_invites_insert on public.hunt_invites for insert to authenticated
  with check (public.is_hunt_member(hunt_id) and created_by = auth.uid()
              and used_by is null and used_at is null);
create policy hunt_invites_delete on public.hunt_invites for delete to authenticated
  using (public.is_hunt_member(hunt_id));

-- Tables scoped by hunt_id: full access for members
create policy pins_all on public.pins for all to authenticated
  using (public.is_hunt_member(hunt_id)) with check (public.is_hunt_member(hunt_id));
create policy listings_select on public.listings for select to authenticated
  using (public.is_hunt_member(hunt_id));
create policy listings_insert on public.listings for insert to authenticated
  with check (public.is_hunt_member(hunt_id) and added_by = auth.uid());
create policy listings_update on public.listings for update to authenticated
  using (public.is_hunt_member(hunt_id)) with check (public.is_hunt_member(hunt_id));
create policy listings_delete on public.listings for delete to authenticated
  using (public.is_hunt_member(hunt_id));

-- Tables scoped by listing_id
create policy listing_photos_all on public.listing_photos for all to authenticated
  using (public.is_listing_member(listing_id))
  with check (public.is_listing_member(listing_id));
create policy listing_price_history_select on public.listing_price_history
  for select to authenticated using (public.is_listing_member(listing_id));
create policy listing_price_history_insert on public.listing_price_history
  for insert to authenticated with check (public.is_listing_member(listing_id));

-- votes: everyone in the hunt reads, each member writes only their own
create policy votes_select on public.votes for select to authenticated
  using (public.is_listing_member(listing_id));
create policy votes_insert on public.votes for insert to authenticated
  with check (user_id = auth.uid() and public.is_listing_member(listing_id));
create policy votes_update on public.votes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy votes_delete on public.votes for delete to authenticated
  using (user_id = auth.uid());

-- reconsider_requests: read by members; written by request_reconsider() (milestone 3)
create policy reconsider_requests_select on public.reconsider_requests
  for select to authenticated using (public.is_listing_member(listing_id));

-- comments: read by members, authored by yourself
create policy comments_select on public.comments for select to authenticated
  using (public.is_listing_member(listing_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (user_id = auth.uid() and public.is_listing_member(listing_id));
create policy comments_update on public.comments for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy comments_delete on public.comments for delete to authenticated
  using (user_id = auth.uid());

-- listing_events: append-only log
create policy listing_events_select on public.listing_events for select to authenticated
  using (public.is_listing_member(listing_id));
create policy listing_events_insert on public.listing_events for insert to authenticated
  with check (user_id = auth.uid() and public.is_listing_member(listing_id));

-- ---------------------------------------------------------------------------
-- Storage: cover thumbnails and user uploads, under "<hunt_id>/..."
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', false, 5242880,
        array['image/webp', 'image/jpeg', 'image/png', 'image/avif'])
on conflict (id) do nothing;

create function public.storage_hunt_id(p_name text)
returns uuid
language plpgsql immutable set search_path = ''
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create policy listing_photos_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'listing-photos' and public.is_hunt_member(public.storage_hunt_id(name)));
create policy listing_photos_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-photos' and public.is_hunt_member(public.storage_hunt_id(name)));
create policy listing_photos_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'listing-photos' and public.is_hunt_member(public.storage_hunt_id(name)));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.hunt_members,
  public.listings,
  public.votes,
  public.comments,
  public.listing_events,
  public.reconsider_requests;
