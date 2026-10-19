-- Milestone 3: deciding together (swipe deck, matches, disagreements, reconsider).
--
-- Vote visibility: to avoid anchoring, a member can only read their own rows in
-- `votes`. Everyone else's swipes and stars reach the client only through the
-- security-definer functions below, which apply the hunt's reveal rule. Because
-- Realtime respects RLS, partners learn about vote changes from `listing_events`,
-- which a trigger on `votes` writes (never with star values in the payload).
--
-- Event types written here (payload always carries hunt_id so clients can filter
-- the realtime stream):
--   voted                {swipe}            a member swiped (new vote or changed swipe)
--   rated                {}                 a member changed only their stars
--   unvoted              {}                 a member cleared their vote (undo)
--   matched              {completed_by}     the vote made every member say yes
--   reconsidered         {note}             a member cleared their own `no`
--   reconsider_requested {target_user, target_name, note}
--   reconsider_resolved  {outcome, requested_by, request_id}

-- ---------------------------------------------------------------------------
-- votes: own rows only
-- ---------------------------------------------------------------------------
drop policy votes_select on public.votes;
create policy votes_select on public.votes for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Vote trigger: event log, reconsider resolution and match detection
-- ---------------------------------------------------------------------------
create function public.votes_after_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_listing_id uuid := coalesce(new.listing_id, old.listing_id);
  v_hunt_id uuid;
  v_members int;
  v_yes int;
begin
  select hunt_id into v_hunt_id from public.listings where id = v_listing_id;
  -- The listing (or the voter's profile) is being deleted: nothing to log.
  if v_hunt_id is null
     or not exists (select 1 from public.profiles
                    where id = coalesce(new.user_id, old.user_id)) then
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.listing_events (listing_id, user_id, type, payload)
    values (old.listing_id, old.user_id, 'unvoted', jsonb_build_object('hunt_id', v_hunt_id));
    return null;
  end if;

  if tg_op = 'INSERT' or new.swipe is distinct from old.swipe then
    insert into public.listing_events (listing_id, user_id, type, payload)
    values (new.listing_id, new.user_id, 'voted',
            jsonb_build_object('hunt_id', v_hunt_id, 'swipe', new.swipe));
  elsif new.stars is distinct from old.stars then
    insert into public.listing_events (listing_id, user_id, type, payload)
    values (new.listing_id, new.user_id, 'rated', jsonb_build_object('hunt_id', v_hunt_id));
  end if;

  -- Any vote from the member a reconsider request targets answers it.
  with resolved as (
    update public.reconsider_requests
    set resolved_at = clock_timestamp(), outcome = new.swipe
    where listing_id = new.listing_id and target_user = new.user_id and resolved_at is null
    returning id, requested_by
  )
  insert into public.listing_events (listing_id, user_id, type, payload)
  select new.listing_id, new.user_id, 'reconsider_resolved',
         jsonb_build_object('hunt_id', v_hunt_id, 'outcome', new.swipe,
                            'requested_by', r.requested_by, 'request_id', r.id)
  from resolved r;

  if new.swipe = 'yes' and (tg_op = 'INSERT' or old.swipe <> 'yes') then
    select count(*), count(*) filter (where v.swipe = 'yes')
    into v_members, v_yes
    from public.hunt_members m
    left join public.votes v on v.listing_id = new.listing_id and v.user_id = m.user_id
    where m.hunt_id = v_hunt_id;

    if v_members > 0 and v_yes = v_members then
      insert into public.listing_events (listing_id, user_id, type, payload)
      values (new.listing_id, new.user_id, 'matched',
              jsonb_build_object('hunt_id', v_hunt_id, 'completed_by', new.user_id));
    end if;
  end if;

  return null;
end;
$$;

create trigger votes_after_change
  after insert or update or delete on public.votes
  for each row execute function public.votes_after_change();

-- ---------------------------------------------------------------------------
-- Swipe deck
-- ---------------------------------------------------------------------------
-- Cards for the caller, in order:
--   1. listings with an open reconsider request aimed at the caller (whatever
--      their own vote or the listing's status), newest request first
--   2. listings the caller hasn't voted on and no member rejected
--   3. listings the caller hasn't voted on that another member rejected
-- Groups 2 and 3 skip listings whose status is `rejected` or `gone` and ads that
-- were taken down (is_active = false): the group has already moved past them.
-- Within each group, newest listing first. `still_no` marks listings whose
-- latest answered reconsider request came back `no`; they keep their place in
-- the normal order.
create function public.next_deck_cards(p_hunt_id uuid, p_limit int default 20)
returns table (
  listing_id uuid,
  deck_group int,
  reconsider_request_id uuid,
  reconsider_note text,
  reconsider_requested_by text,
  rejected_by text[],
  reconsider_pending boolean,
  still_no boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_hunt_member(p_hunt_id) then
    raise exception 'not a member of this hunt' using errcode = '42501';
  end if;

  return query
  with cards as (
    select
      l.id,
      l.created_at,
      req.id as req_id,
      req.note as req_note,
      req.requester as req_by,
      req.created_at as req_at,
      exists (select 1 from public.votes v
              where v.listing_id = l.id and v.user_id = auth.uid()) as voted,
      l.status in ('rejected', 'gone') or not l.is_active as archived,
      array(
        select p.display_name
        from public.votes v
        join public.hunt_members m on m.hunt_id = l.hunt_id and m.user_id = v.user_id
        join public.profiles p on p.id = v.user_id
        where v.listing_id = l.id and v.swipe = 'no' and v.user_id <> auth.uid()
        order by p.display_name
      ) as rejecters,
      exists (select 1 from public.reconsider_requests r
              where r.listing_id = l.id and r.resolved_at is null) as pending,
      coalesce((select r.outcome = 'no' from public.reconsider_requests r
                where r.listing_id = l.id and r.resolved_at is not null
                order by r.resolved_at desc limit 1), false) as still_no
    from public.listings l
    left join lateral (
      select r.id, r.note, r.created_at, p.display_name as requester
      from public.reconsider_requests r
      join public.profiles p on p.id = r.requested_by
      where r.listing_id = l.id and r.target_user = auth.uid() and r.resolved_at is null
    ) req on true
    where l.hunt_id = p_hunt_id
  ), grouped as (
    select c.*,
           case
             when c.req_id is not null then 1
             when c.voted or c.archived then null
             when cardinality(c.rejecters) = 0 then 2
             else 3
           end as grp
    from cards c
  )
  select g.id, g.grp, g.req_id, g.req_note, g.req_by, g.rejecters, g.pending, g.still_no
  from grouped g
  where g.grp is not null
  order by g.grp, coalesce(g.req_at, g.created_at) desc, g.id
  limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

-- ---------------------------------------------------------------------------
-- Listing summaries (the spec's `listing_summary`)
-- ---------------------------------------------------------------------------
-- One row per listing in the hunt. Only current members' votes count.
--   member_votes      [{user_id, display_name, swipe, stars}] for every member,
--                     in join order; swipe is null when they haven't voted.
--   votes_revealed    false while the hunt hides stars (reveal_votes_after_both)
--                     and someone hasn't voted yet. Until then other members'
--                     stars are null and combined_score is null. Swipes are
--                     always visible.
--   combined_score    average of the members' stars, +1 when it's a match. A
--                     match nobody rated scores 1. Null without stars or before reveal.
--   is_match          every member swiped yes
--   is_disagreement   someone said yes and someone said no, or (once revealed)
--                     the stars differ by 2 or more
--   is_maybe          someone swiped maybe
--   still_no          the latest answered reconsider request came back `no`
--   criteria_violations  always [] for now; milestone 4 (hunt criteria) fills it.
create function public.hunt_listing_summaries(p_hunt_id uuid)
returns table (
  listing_id uuid,
  total_monthly numeric,
  my_swipe public.swipe,
  my_stars smallint,
  member_votes jsonb,
  voted_count int,
  member_count int,
  votes_revealed boolean,
  combined_score numeric,
  is_match boolean,
  is_disagreement boolean,
  is_maybe boolean,
  reconsider_pending boolean,
  still_no boolean,
  criteria_violations jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_hide_stars boolean;
  v_member_count int;
begin
  if not public.is_hunt_member(p_hunt_id) then
    raise exception 'not a member of this hunt' using errcode = '42501';
  end if;

  select h.reveal_votes_after_both into v_hide_stars from public.hunts h where h.id = p_hunt_id;
  select count(*) into v_member_count from public.hunt_members m where m.hunt_id = p_hunt_id;

  return query
  with members as (
    select m.user_id, m.joined_at, p.display_name
    from public.hunt_members m
    join public.profiles p on p.id = m.user_id
    where m.hunt_id = p_hunt_id
  ), stats as (
    select
      l.id,
      l.rent,
      l.admin_fee,
      l.utilities_estimate,
      s.voted,
      s.yes_n,
      s.no_n,
      s.maybe_n,
      s.avg_stars,
      s.star_spread,
      (not v_hide_stars or s.voted = v_member_count) as revealed
    from public.listings l
    cross join lateral (
      select count(v.user_id)::int as voted,
             (count(*) filter (where v.swipe = 'yes'))::int as yes_n,
             (count(*) filter (where v.swipe = 'no'))::int as no_n,
             (count(*) filter (where v.swipe = 'maybe'))::int as maybe_n,
             avg(v.stars) as avg_stars,
             max(v.stars) - min(v.stars) as star_spread
      from members m
      join public.votes v on v.listing_id = l.id and v.user_id = m.user_id
    ) s
    where l.hunt_id = p_hunt_id
  )
  select
    st.id,
    case when st.rent is null then null
         else st.rent + coalesce(st.admin_fee, 0) + coalesce(st.utilities_estimate, 0) end,
    mine.swipe,
    mine.stars,
    (select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', m.user_id,
               'display_name', m.display_name,
               'swipe', v.swipe,
               'stars', case when m.user_id = auth.uid() or st.revealed then v.stars end)
             order by m.joined_at, m.user_id), '[]'::jsonb)
     from members m
     left join public.votes v on v.listing_id = st.id and v.user_id = m.user_id),
    st.voted,
    v_member_count,
    st.revealed,
    case
      when not st.revealed then null
      when st.avg_stars is null then case when st.yes_n = v_member_count then 1.0 end
      else round(st.avg_stars, 2) + case when st.yes_n = v_member_count then 1 else 0 end
    end,
    v_member_count > 0 and st.yes_n = v_member_count,
    (st.yes_n > 0 and st.no_n > 0) or (st.revealed and coalesce(st.star_spread, 0) >= 2),
    st.maybe_n > 0,
    exists (select 1 from public.reconsider_requests r
            where r.listing_id = st.id and r.resolved_at is null),
    coalesce((select r.outcome = 'no' from public.reconsider_requests r
              where r.listing_id = st.id and r.resolved_at is not null
              order by r.resolved_at desc limit 1), false),
    '[]'::jsonb
  from stats st
  left join public.votes mine on mine.listing_id = st.id and mine.user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Reconsider
-- ---------------------------------------------------------------------------
-- Takes a rejected listing back into consideration. If the caller said `no`,
-- their vote is cleared and the listing is back in their deck right away. Every
-- other member who said `no` gets a request (at most one open per listing and
-- member; an existing open request is left as it is). Returns
-- {cleared_own: bool, requested: [user ids], already_open: [user ids]}.
create function public.request_reconsider(p_listing_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_hunt_id uuid;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_cleared boolean := false;
  v_requested uuid[] := '{}';
  v_already uuid[] := '{}';
  v_target record;
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_listing_member(p_listing_id) then
    raise exception 'not a member of this hunt' using errcode = '42501';
  end if;
  if length(v_note) > 500 then
    raise exception 'note is too long' using errcode = '22001';
  end if;

  select hunt_id into v_hunt_id from public.listings where id = p_listing_id;

  delete from public.votes
  where listing_id = p_listing_id and user_id = auth.uid() and swipe = 'no';
  if found then
    v_cleared := true;
    insert into public.listing_events (listing_id, user_id, type, payload)
    values (p_listing_id, auth.uid(), 'reconsidered',
            jsonb_build_object('hunt_id', v_hunt_id, 'note', v_note));
  end if;

  for v_target in
    select v.user_id, p.display_name
    from public.votes v
    join public.hunt_members m on m.hunt_id = v_hunt_id and m.user_id = v.user_id
    join public.profiles p on p.id = v.user_id
    where v.listing_id = p_listing_id and v.swipe = 'no' and v.user_id <> auth.uid()
    order by p.display_name
  loop
    insert into public.reconsider_requests (listing_id, requested_by, target_user, note)
    values (p_listing_id, auth.uid(), v_target.user_id, v_note)
    on conflict (listing_id, target_user) where resolved_at is null do nothing
    returning id into v_request_id;

    if v_request_id is null then
      v_already := v_already || v_target.user_id;
    else
      v_requested := v_requested || v_target.user_id;
      insert into public.listing_events (listing_id, user_id, type, payload)
      values (p_listing_id, auth.uid(), 'reconsider_requested',
              jsonb_build_object('hunt_id', v_hunt_id, 'target_user', v_target.user_id,
                                 'target_name', v_target.display_name, 'note', v_note));
    end if;
    v_request_id := null;
  end loop;

  return jsonb_build_object('cleared_own', v_cleared, 'requested', to_jsonb(v_requested),
                            'already_open', to_jsonb(v_already));
end;
$$;

revoke execute on function
  public.next_deck_cards(uuid, int),
  public.hunt_listing_summaries(uuid),
  public.request_reconsider(uuid, text)
from public, anon;
grant execute on function
  public.next_deck_cards(uuid, int),
  public.hunt_listing_summaries(uuid),
  public.request_reconsider(uuid, text)
to authenticated;
revoke execute on function public.votes_after_change() from public, anon, authenticated;
