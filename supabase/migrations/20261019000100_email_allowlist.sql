-- Sign-up allowlist: only listed emails can create an account (magic link or Google).
-- An entry is either a full address or "@domain" for a whole domain.
-- Manage it from the SQL editor; clients can't read or write this table.
-- It starts empty: add the owners' addresses after the first deploy (see README).

create table public.signup_allowlist (
  entry text primary key check (entry = lower(entry) and entry like '%@%'),
  added_at timestamptz not null default now()
);
alter table public.signup_allowlist enable row level security;
revoke all on public.signup_allowlist from anon, authenticated;

create function public.enforce_signup_allowlist()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(coalesce(new.email, ''));
begin
  if not exists (
    select 1 from public.signup_allowlist a
    where a.entry = v_email
       or (a.entry like '@%' and right(v_email, length(a.entry)) = a.entry)
  ) then
    raise exception 'signup not allowed for %', v_email using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_signup_allowlist() from public, anon, authenticated;

create trigger enforce_signup_allowlist
  before insert on auth.users
  for each row execute function public.enforce_signup_allowlist();
