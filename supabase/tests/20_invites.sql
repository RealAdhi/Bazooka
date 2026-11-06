\pset tuples_only on
-- Signing up with an invited email makes you a member with the invited role.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'Adhithya.Sriram@glance.com');
do $$ begin
  assert (select role from public.members where id = '00000000-0000-0000-0000-0000000000d1') = 'admin', 'invited admin should become admin';
  assert (select accepted_at is not null from public.invites where email = 'adhithya.sriram@glance.com'), 'invite marked accepted';
end $$;

-- An uninvited user gets no membership.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d2', 'stranger@example.com');
do $$ begin
  assert not exists (select 1 from public.members where id = '00000000-0000-0000-0000-0000000000d2'), 'stranger must not become a member';
end $$;

-- Inviting someone who already has an auth account links them straight away.
insert into public.invites (email, full_name) values ('stranger@example.com', 'Now invited');
do $$ begin
  assert (select role from public.members where id = '00000000-0000-0000-0000-0000000000d2') = 'member', 'existing user linked on invite';
end $$;

-- Only the admin can read or write invites.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', false);
do $$ begin
  assert (select count(*) from public.invites) = 0, 'a member cannot see invites';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
do $$ begin
  assert (select count(*) from public.invites) >= 2, 'admin sees invites';
end $$;
reset role;
\echo 'invite tests passed'
