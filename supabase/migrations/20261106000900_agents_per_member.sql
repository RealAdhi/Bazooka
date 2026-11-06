-- Each team member has their own agents (everyone has an Instinct). Shared agents have no owner.
alter table public.agents add column if not exists owner_id uuid references public.members (id) on delete set null;

-- The existing Instinct (and its token, if any) belongs to Adhithya; Piyush's Grok bot belongs to Piyush.
update public.agents set owner_id = (select id from public.members where email = 'adhithya.sriram@glance.com'),
       name = 'Instinct (Adhithya)' where slug = 'instinct';
update public.agents set owner_id = (select id from public.members where email = 'piyush@glance.com') where slug = 'grok-piyush';

-- One Instinct per other member, switched off until the admin creates its token.
insert into public.agents (slug, name, kind, scopes, enabled, owner_id)
select 'instinct-' || lower(split_part(m.full_name, ' ', 1)), 'Instinct (' || m.full_name || ')', 'instinct',
       '{capture:write,board:read,board:write}', false, m.id
from public.members m
where m.active and not exists (select 1 from public.agents a where a.kind = 'instinct' and a.owner_id = m.id)
on conflict (slug) do nothing;

-- OpenRouter becomes an AI option (admin picks it in AI and voice).
update public.settings
   set value = jsonb_set(value, '{models,openrouter}', '"openrouter/auto"', true)
 where key = 'llm' and not (value -> 'models' ? 'openrouter');
