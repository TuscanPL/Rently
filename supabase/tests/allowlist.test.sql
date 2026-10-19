-- Only allowlisted emails can create an account.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

delete from public.signup_allowlist;
insert into public.signup_allowlist (entry) values ('owner@example.org'), ('@family.test');

select lives_ok(
  $$ insert into auth.users (id, email) values (gen_random_uuid(), 'owner@example.org') $$,
  'listed address can sign up');
select lives_ok(
  $$ insert into auth.users (id, email) values (gen_random_uuid(), 'Mum@Family.test') $$,
  'listed domain can sign up, case-insensitive');
select throws_ok(
  $$ insert into auth.users (id, email) values (gen_random_uuid(), 'stranger@gmail.com') $$,
  '42501', null, 'unlisted address is rejected');
select throws_ok(
  $$ insert into auth.users (id, email) values (gen_random_uuid(), 'x@evilfamily.test') $$,
  '42501', null, 'domain entry does not match a lookalike domain');
select throws_ok(
  $$ insert into auth.users (id, email) values (gen_random_uuid(), null) $$,
  '42501', null, 'user without email (e.g. phone) is rejected');

set local role authenticated;
select throws_ok('select * from public.signup_allowlist', '42501', null,
                 'clients cannot read the allowlist');

select * from finish();
rollback;
