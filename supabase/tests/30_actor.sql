\pset tuples_only on
-- Server functions (service role) acting for an agent or member are attributed from the header.
insert into public.agents (slug, name, kind) values ('t-agent', 'Test agent', 'other');
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select set_config('request.headers', '{"x-bazooka-actor":"agent:t-agent"}', false);
update public.founders set stage = 'seed' where slug = 'mandrake';
select set_config('request.headers', '{"x-bazooka-actor":"member:00000000-0000-0000-0000-00000000000a"}', false);
update public.founders set stage = 'pre-seed' where slug = 'mandrake';
update public.agents set last_used_at = now() where slug = 't-agent';
reset role;
select set_config('request.headers', '', false);
select set_config('request.jwt.claims', '', false);
do $$ begin
  assert (select actor_label from public.activity_log where table_name = 'founders' and 'stage' = any(changed) order by id desc offset 1 limit 1) = 'Test agent', 'agent header attribution';
  assert (select actor_label from public.activity_log where table_name = 'founders' and 'stage' = any(changed) order by id desc limit 1) = 'Adhithya', 'member header attribution';
  assert not exists (select 1 from public.activity_log where table_name = 'agents' and changed = '{last_used_at}'), 'last_used_at not logged';
end $$;

-- A non-service caller cannot fake the header.
set role authenticated;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
select set_config('request.headers', '{"x-bazooka-actor":"agent:t-agent"}', false);
do $$ begin assert (public.current_actor() ->> 'type') = 'system', 'header ignored for non-service callers'; end $$;
reset role;
\echo 'actor tests passed'
