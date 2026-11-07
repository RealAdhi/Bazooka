-- Agent-first Bazooka: agents (Grok bot, Instinct, ...) do all the thinking and research and save
-- structured results here. Bazooka stores, checks and shows them. No AI runs on our side.
--  * conversations: transcripts per company
--  * company: where_we_are, round, needs per type (customer / investor / advisor)
--  * people suggested for a company: LinkedIn, why, degree, origin, Piyush's request
--  * messages (the drafts table): draft -> approved -> sent
--  * limits: at most 2 sources per company, at most 3 open suggestions per type
--  * stage moves forward by itself as people are suggested, messages sent and meetings happen
--  * save_v3(): one transaction for save_conversation / save_people

-- ---------------------------------------------------------------------------
-- Company fields
-- ---------------------------------------------------------------------------
alter table public.founders
  add column if not exists where_we_are  text,
  add column if not exists round         text,
  add column if not exists need_customer text,
  add column if not exists need_investor text,
  add column if not exists need_advisor  text;

-- Carry the old stage + raise into "round" (the old columns stay, hidden).
update public.founders
   set round = nullif(trim(concat_ws('', stage, raise_clause)), '')
 where round is null and (stage is not null or raise_clause is not null);

-- ---------------------------------------------------------------------------
-- Conversations: one per meeting or call, per company
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  founder_id  uuid not null references public.founders (id) on delete cascade,
  happened_on date,
  title       text,
  summary     text,
  transcript  text,
  notes       text,
  origin      text not null default 'agent' check (origin in ('app', 'agent', 'pasted')),
  created_by  uuid references public.members (id),
  agent_id    uuid references public.agents (id),
  capture_id  uuid references public.captures (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists conversations_founder_idx on public.conversations (founder_id, happened_on desc);
alter table public.conversations enable row level security;
create policy members_all on public.conversations for all to authenticated using (public.is_member()) with check (public.is_member());
create trigger conversations_touch before update on public.conversations for each row execute function public.touch_updated_at();
create trigger conversations_audit after insert or update or delete on public.conversations for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- People suggested for a company (connections)
-- ---------------------------------------------------------------------------
alter table public.connections
  add column if not exists degree          smallint check (degree between 1 and 3),
  add column if not exists origin          text check (origin in ('named', 'research', 'person')),
  add column if not exists request         text,
  add column if not exists conversation_id uuid references public.conversations (id) on delete set null;

-- The empty "Potential customer/investor/advisor" slots are gone: people now come from agents' research.
update public.connections set archived_at = now() where person_id is null and archived_at is null;

create index if not exists people_linkedin_idx on public.people (lower(linkedin_url)) where linkedin_url is not null;

-- ---------------------------------------------------------------------------
-- Messages (drafts table): draft -> approved -> sent
-- ---------------------------------------------------------------------------
alter table public.drafts drop constraint if exists drafts_status_check;
alter table public.drafts add constraint drafts_status_check check (status in ('draft', 'approved', 'sent', 'discarded'));
alter table public.drafts alter column template_key drop not null;
alter table public.drafts
  add column if not exists channel     text,
  add column if not exists subject     text,
  add column if not exists approved_at timestamptz;

-- ---------------------------------------------------------------------------
-- Limits
-- ---------------------------------------------------------------------------
create or replace function public.limit_sources() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.founder_sources where founder_id = new.founder_id) >= 2 then
    raise exception 'A company can have at most 2 sources (usually 1). Remove one first.';
  end if;
  return new;
end $$;
drop trigger if exists founder_sources_limit on public.founder_sources;
create trigger founder_sources_limit before insert on public.founder_sources for each row execute function public.limit_sources();

create or replace function public.limit_suggestions() returns trigger
language plpgsql as $$
begin
  if new.archived_at is null and new.status = 'suggested' and new.person_id is not null and
     (select count(*) from public.connections c
       where c.founder_id = new.founder_id and c.type = new.type and c.id <> new.id
         and c.archived_at is null and c.status = 'suggested' and c.person_id is not null) >= 3 then
    raise exception 'A company can have at most 3 suggested % people at a time.', new.type;
  end if;
  return new;
end $$;
drop trigger if exists connections_limit on public.connections;
create trigger connections_limit before insert or update of status, archived_at, type on public.connections
  for each row execute function public.limit_suggestions();

-- ---------------------------------------------------------------------------
-- Stage moves forward by itself (never backwards, never past "completed")
-- ---------------------------------------------------------------------------
create or replace function public.advance_stage(p_founder uuid, p_target public.founder_status) returns void
language sql security definer set search_path = public as $$
  update public.founders set status = p_target
   where id = p_founder and status < p_target and status <> 'completed';
$$;

create or replace function public.stage_from_connection() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.archived_at is not null or new.person_id is null then return new; end if;
  perform public.advance_stage(new.founder_id, case new.status
    when 'intro_sent' then 'intros_sent'::public.founder_status
    when 'meeting_happened' then 'meeting_happened'::public.founder_status
    else 'connections_suggested'::public.founder_status end);
  return new;
end $$;
drop trigger if exists connections_stage on public.connections;
create trigger connections_stage after insert or update of status, person_id, archived_at on public.connections
  for each row execute function public.stage_from_connection();

create or replace function public.stage_from_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sent' then
    perform public.advance_stage(new.founder_id, 'intros_sent');
    if new.connection_id is not null and coalesce(new.template_key, '') like 'intro%' then
      update public.connections set status = 'intro_sent'
       where id = new.connection_id and status in ('suggested', 'approved');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists drafts_stage on public.drafts;
create trigger drafts_stage after insert or update of status on public.drafts
  for each row execute function public.stage_from_message();

-- ---------------------------------------------------------------------------
-- Log and undo cover the new table; transcripts are too large for the log
-- ---------------------------------------------------------------------------
create or replace function public.audit_strip(t text, j jsonb) returns jsonb
language sql immutable as $$
  select case t
    when 'agents'        then j - 'token_hash'
    when 'captures'      then j - 'transcript' - 'utterances' - 'llm_output' - 'notes_text'
    when 'invites'       then j || jsonb_build_object('id', j ->> 'email')
    when 'conversations' then j - 'transcript'
    else j end;
$$;

create or replace function public.undo_activity(p_log_id bigint) returns bigint
language plpgsql security invoker set search_path = public as $$
declare
  l       public.activity_log;
  cols    text;
  new_id  bigint;
  allowed text[] := array['sources','buckets','lanes','people','companies','founders','founder_sources',
                          'connections','templates','variables','drafts','follow_ups','founder_team','conversations'];
begin
  select * into l from public.activity_log where id = p_log_id;
  if not found then raise exception 'No log entry %', p_log_id; end if;
  if l.undone_by is not null then raise exception 'Already undone'; end if;
  if not (l.table_name = any (allowed)) then raise exception 'Changes to % cannot be undone here', l.table_name; end if;

  if l.action = 'update' then
    select string_agg(format('%I', c), ', ') into cols from unnest(l.changed) c;
    execute format('update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where t.id = $2::uuid',
                   l.table_name, cols, cols, l.table_name)
      using l.before, l.row_id;
  elsif l.action = 'insert' then
    if l.table_name = 'founder_sources' then
      delete from public.founder_sources
       where founder_id = (l.after ->> 'founder_id')::uuid and source_id = (l.after ->> 'source_id')::uuid;
    elsif l.after ? 'archived_at' then
      execute format('update public.%I set archived_at = now() where id = $1::uuid', l.table_name) using l.row_id;
    else
      execute format('delete from public.%I where id = $1::uuid', l.table_name) using l.row_id;
    end if;
  elsif l.action = 'delete' then
    execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', l.table_name, l.table_name)
      using l.before;
  end if;

  select max(id) into new_id from public.activity_log where table_name = l.table_name and row_id = l.row_id;
  update public.activity_log set undone_by = new_id where id = p_log_id;
  return new_id;
end $$;

-- ---------------------------------------------------------------------------
-- Message guides: the six templates now guide the agent, which writes the message.
-- {{...}} = Bazooka fills from the card; [ ... ] = the agent writes it.
-- ---------------------------------------------------------------------------
update public.templates set subject = 'Intro: {{founder_first_name}} ({{company}}) and {{connection_first_name}}', body =
'Guys, quick intro.
{{connection_first_name}}, meet {{founder_first_name}}. They''re building {{company}}: {{one_liner}}. We met at [where Piyush met them].
{{founder_first_name}}, {{connection_first_name}} is {{connection_title}} at {{connection_org}}. [One line on why this person fits, from your research.] I think {{company}} could be really useful there, maybe as an early customer or design partner.
I''ll let you two take it from here.
Piyush' where key = 'intro_customer';

update public.templates set subject = 'Connecting you two: {{company}} and {{connection_org}}', body =
'Guys, connecting you two.
{{connection_first_name}}, {{founder_first_name}} is building {{company}}: {{one_liner}}. They''re at {{round}}. What stood out to me: [one thing about the founder, in Piyush''s words].
I think it fits your focus on [their investment focus, from your research].
{{founder_first_name}}, {{connection_first_name}} is {{connection_title}} at {{connection_org}}.
Over to you both.
Piyush' where key = 'intro_investor';

update public.templates set subject = 'An intro I''ve been meaning to make', body =
'Guys, an intro I''ve been meaning to make.
{{connection_first_name}}, {{founder_first_name}} at {{company}} is working on {{one_liner}} and could use a sharp view on [what they need advice on]. Nobody I know understands this better than you.
{{founder_first_name}}, {{connection_first_name}} is {{connection_title}} at {{connection_org}}.
Piyush' where key = 'intro_advisor';

update public.templates set body =
'Hi {{founder_first_name}}, how did it go with {{connection_first_name}}? Did anything useful come out of it? Even a one-line reply helps me make better intros next time.'
where key = 'follow_up';

update public.templates set body =
'Hi {{founder_first_name}}, was thinking about {{company}} after we met at [where Piyush met them]. Saw [recent progress, if you found any], great to see.
If something is blocking you right now, tell me and I''ll see who can help.'
where key = 'keep_warm';

update public.templates set subject = '30 minutes on [topic]?', body =
'Hi {{founder_first_name}}, I kept coming back to [the topic from our conversation] after our chat. There may be a real overlap with what we''re doing at InMobi and Glance.
Up for a 30-minute deeper conversation in the next couple of weeks? Happy to work around your time.
Piyush' where key = 'deeper_strategy';

-- ---------------------------------------------------------------------------
-- Search prompts and the AI switch
-- ---------------------------------------------------------------------------
insert into public.settings (key, value) values ('search_prompts', jsonb_build_object(
  'customer', 'Search Piyush''s LinkedIn network (1st-degree connections first, then 2nd) for people who could become early customers or design partners for {company}. {company}: {one_liner}. What they need: {need}. Look for the person who would buy or champion this: heads of the relevant function, founders or CXOs at organisations that have this problem. For each person give their LinkedIn link, current title and organisation, connection degree, and one line on why they fit {company}''s need. Return up to 3. If fewer than 3 are genuinely good fits, return only those and say so.',
  'investor', 'Search Piyush''s LinkedIn network (1st-degree connections first, then 2nd) for investors who fit {company}. {company}: {one_liner}. Round: {round}. What they need: {need}. Look for partners at funds, angels and operator-investors whose stage and sector focus matches, ideally who have backed similar companies. For each person give their LinkedIn link, current title and organisation, connection degree, and one line on why their focus fits {company}. Return up to 3. If fewer than 3 are genuinely good fits, return only those and say so.',
  'advisor', 'Search Piyush''s LinkedIn network (1st-degree connections first, then 2nd) for people who could advise {company}. {company}: {one_liner}. Domain: {domain}. What they need: {need}. Look for founders and operators who have built or scaled something close to this and can help with exactly that need. For each person give their LinkedIn link, current title and organisation, connection degree, and one line on why they can help {company}. Return up to 3. If fewer than 3 are genuinely good fits, return only those and say so.'
)) on conflict (key) do nothing;

insert into public.settings (key, value) values ('ai_mode', '"agent"') on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- save_v3: one transaction for save_conversation and save_people.
-- The API checks the shape first (api/_lib/schema-v3.js); this applies it.
-- p_kind: 'conversation' | 'people'. Returns what changed. Retries with the same external_id
-- return the first result.
-- ---------------------------------------------------------------------------
create or replace function public.norm_site(t text) returns text
language sql immutable as $$ select nullif(lower(regexp_replace(coalesce(t, ''), '^https?://(www\.)?|/+$', '', 'g')), '') $$;

create or replace function public.save_v3(p jsonb, p_kind text, p_agent uuid, p_member uuid, p_channel text default 'api')
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  ext      text := nullif(p ->> 'external_id', '');
  prev     jsonb;
  cap_id   uuid;
  co       jsonb := coalesce(p -> 'company', '{}'::jsonb);
  v_slug   text := nullif(coalesce(p ->> 'slug', co ->> 'slug'), '');
  fid      uuid;
  cid      uuid;
  f        public.founders;
  dup      text;
  lane     uuid;
  conv_id  uuid;
  pid      uuid;
  conn_id  uuid;
  x        jsonb;
  t        text;
  n        int;
  changes  jsonb := '[]'::jsonb;
  v_people jsonb := '[]'::jsonb;
  srcs     uuid[];
  v_result jsonb;
  who_tag  text := case when p_agent is not null then 'agent:' || (select slug from public.agents where id = p_agent)
                        else 'member:' || p_member::text end;
begin
  -- Retry of something already saved: answer with the first result.
  if ext is not null then
    select c.result into prev from public.captures c
     where c.external_id = ext and c.status = 'processed'
       and ((p_agent is not null and c.agent_id = p_agent) or (p_agent is null and c.created_by = p_member))
     limit 1;
    if prev is not null then return prev || '{"duplicate": true}'::jsonb; end if;
  end if;

  insert into public.captures (channel, status, created_by, agent_id, external_id, transcript, llm_output, llm_provider)
  values (p_channel::public.capture_channel, 'processing', p_member, p_agent, ext, p -> 'conversation' ->> 'transcript', p, 'agent')
  returning id into cap_id;
  perform set_config('bazooka.capture_id', cap_id::text, true);

  -- Which company?
  if v_slug is not null then
    select * into f from public.founders where slug = v_slug and archived_at is null;
    if not found then
      raise exception 'No company with slug "%". Call get_board to find the right slug%.', v_slug,
        case when p_kind = 'conversation' then ', or send company.slug null to add a new company' else '' end;
    end if;
    fid := f.id; cid := f.company_id;
  elsif p_kind = 'conversation' then
    if coalesce(trim(co ->> 'name'), '') = '' then raise exception 'company.name is required for a new company.'; end if;
    select fo.slug into dup from public.founders fo join public.companies c on c.id = fo.company_id
     where fo.archived_at is null
       and (lower(trim(c.name)) = lower(trim(co ->> 'name'))
            or (public.norm_site(co ->> 'website') is not null and public.norm_site(c.website) = public.norm_site(co ->> 'website')))
     limit 1;
    if dup is not null then
      raise exception '"%" is already on the board as slug "%". Send company.slug "%" to update it instead of adding it again.', co ->> 'name', dup, dup;
    end if;
    insert into public.companies (name, one_liner, website) values (trim(co ->> 'name'), co ->> 'one_liner', co ->> 'website') returning id into cid;
    if co ->> 'domain' is not null then
      select id into lane from public.lanes where slug = co ->> 'domain' and archived_at is null;
      if lane is null then raise exception 'No domain "%". get_board lists the domains (lanes) and their slugs.', co ->> 'domain'; end if;
    end if;
    v_slug := left(trim(both '-' from regexp_replace(lower(co ->> 'name'), '[^a-z0-9]+', '-', 'g')), 50);
    if v_slug = '' then v_slug := 'company'; end if;
    n := 1;
    while exists (select 1 from public.founders where slug = v_slug || case when n = 1 then '' else '-' || n end) loop n := n + 1; end loop;
    v_slug := v_slug || case when n = 1 then '' else '-' || n end;
    insert into public.founders (slug, company_id, lane_id, status, met_on, position)
    values (v_slug, cid, lane, 'new', nullif(co ->> 'met_on', '')::date,
            coalesce((select max(position) + 1 from public.founders where lane_id is not distinct from lane and archived_at is null), 0))
    returning * into f;
    fid := f.id;
    changes := changes || jsonb_build_object('what', 'company', 'action', 'added', 'label', co ->> 'name');
  else
    raise exception 'slug is required.';
  end if;

  -- Company fields (only what was sent; null = no change)
  if cid is not null and nullif(trim(co ->> 'name'), '') is not null then
    update public.companies set name = trim(co ->> 'name') where id = cid and name is distinct from trim(co ->> 'name');
  end if;
  if cid is not null and (co ->> 'one_liner' is not null or co ->> 'website' is not null) then
    update public.companies set one_liner = coalesce(co ->> 'one_liner', one_liner), website = coalesce(co ->> 'website', website) where id = cid;
  end if;
  if co ->> 'domain' is not null then
    select id into lane from public.lanes where slug = co ->> 'domain' and archived_at is null;
    if lane is null then raise exception 'No domain "%". get_board lists the domains (lanes) and their slugs.', co ->> 'domain'; end if;
    update public.founders set lane_id = lane where id = fid and lane_id is distinct from lane;
  end if;
  update public.founders set
    round         = coalesce(co ->> 'round', round),
    met_on        = coalesce(nullif(co ->> 'met_on', '')::date, met_on),
    where_we_are  = coalesce(p ->> 'where_we_are', where_we_are),
    need_customer = coalesce(p -> 'needs' ->> 'customer', need_customer),
    need_investor = coalesce(p -> 'needs' ->> 'investor', need_investor),
    need_advisor  = coalesce(p -> 'needs' ->> 'advisor', need_advisor),
    private_notes = case when nullif(p ->> 'private_note', '') is null then private_notes
                         else concat_ws(E'\n', private_notes, to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD') || ': ' || (p ->> 'private_note')) end
  where id = fid;

  -- Sources (replace; at most 2)
  if jsonb_typeof(co -> 'sources') = 'array' then
    select array_agg(s.id order by o.i) into srcs
      from jsonb_array_elements_text(co -> 'sources') with ordinality o(slug, i)
      left join public.sources s on s.slug = o.slug and s.archived_at is null;
    if array_position(srcs, null) is not null then
      raise exception 'Unknown source in company.sources. Use the source slugs from get_board, or add the source first with add_source.';
    end if;
    delete from public.founder_sources where founder_id = fid and not (source_id = any (coalesce(srcs, '{}')));
    insert into public.founder_sources (founder_id, source_id, is_primary)
      select fid, s, i = 1 from unnest(srcs) with ordinality u(s, i)
      where not exists (select 1 from public.founder_sources where founder_id = fid and source_id = s);
  end if;

  -- Founders: matched by LinkedIn link, then by name within this company
  for x in select * from jsonb_array_elements(coalesce(p -> 'founders', '[]'::jsonb)) loop
    pid := null;
    select pe.id into pid from public.founder_team ft join public.people pe on pe.id = ft.person_id
     where ft.founder_id = fid and ((x ->> 'linkedin' is not null and lower(pe.linkedin_url) = lower(x ->> 'linkedin'))
                                    or lower(trim(pe.full_name)) = lower(trim(x ->> 'name')))
     limit 1;
    if pid is null and x ->> 'linkedin' is not null then
      select id into pid from public.people where lower(linkedin_url) = lower(x ->> 'linkedin') and archived_at is null limit 1;
    end if;
    if pid is null then
      insert into public.people (full_name, first_name, linkedin_url, tags)
      values (trim(x ->> 'name'), split_part(trim(x ->> 'name'), ' ', 1), x ->> 'linkedin', '{founder}') returning id into pid;
      changes := changes || jsonb_build_object('what', 'founder', 'action', 'added', 'label', x ->> 'name');
    else
      update public.people set full_name = trim(x ->> 'name'), linkedin_url = coalesce(x ->> 'linkedin', linkedin_url) where id = pid;
    end if;
    insert into public.founder_team (founder_id, person_id, role, position)
    values (fid, pid, x ->> 'role', coalesce((select max(position) + 1 from public.founder_team where founder_id = fid), 0))
    on conflict (founder_id, person_id) do update set role = coalesce(excluded.role, public.founder_team.role);
    update public.founders set person_id = pid where id = fid and person_id is null;
  end loop;

  -- The conversation itself
  if p -> 'conversation' is not null and jsonb_typeof(p -> 'conversation') = 'object' then
    insert into public.conversations (founder_id, happened_on, title, summary, transcript, origin, created_by, agent_id, capture_id)
    values (fid, nullif(p -> 'conversation' ->> 'date', '')::date, p -> 'conversation' ->> 'title', p -> 'conversation' ->> 'summary',
            p -> 'conversation' ->> 'transcript', case when p_agent is null then 'pasted' else 'agent' end, p_member, p_agent, cap_id)
    returning id into conv_id;
    changes := changes || jsonb_build_object('what', 'conversation', 'action', 'added', 'label', coalesce(p -> 'conversation' ->> 'title', 'Conversation'));
  end if;

  -- People: each type needs a need on the company. Saving a type replaces that type's earlier
  -- suggestions nobody has acted on yet; people already approved, introduced or met are kept.
  select * into f from public.founders where id = fid;
  for t in select distinct x2 ->> 'type' from jsonb_array_elements(coalesce(p -> 'people', '[]'::jsonb)) x2 loop
    if (t = 'customer' and coalesce(f.need_customer, '') = '') or (t = 'investor' and coalesce(f.need_investor, '') = '')
       or (t = 'advisor' and coalesce(f.need_advisor, '') = '') then
      raise exception 'people has % entries but this company has no % need. Only search for what was asked; if Piyush asked for it, also send needs.% with what exactly.', t, t, t;
    end if;
    update public.connections set archived_at = now()
     where founder_id = fid and type = t::public.connection_type and status = 'suggested' and archived_at is null;
  end loop;

  n := 0;
  for x in select * from jsonb_array_elements(coalesce(p -> 'people', '[]'::jsonb)) loop
    n := n + 1;
    pid := null;
    if x ->> 'linkedin' is not null then
      select id into pid from public.people where lower(linkedin_url) = lower(x ->> 'linkedin') and archived_at is null limit 1;
    end if;
    if pid is null then
      insert into public.people (full_name, first_name, linkedin_url, title, org, tags)
      values (trim(x ->> 'name'), split_part(trim(x ->> 'name'), ' ', 1), x ->> 'linkedin', x ->> 'title', x ->> 'org', '{network}')
      returning id into pid;
    else
      update public.people set full_name = trim(x ->> 'name'), title = coalesce(x ->> 'title', title), org = coalesce(x ->> 'org', org) where id = pid;
    end if;
    select id into conn_id from public.connections
     where founder_id = fid and person_id = pid and type = (x ->> 'type')::public.connection_type and archived_at is null limit 1;
    if conn_id is null then
      insert into public.connections (founder_id, person_id, type, reason, title, org, degree, origin, request, conversation_id, rank, status, suggested_by)
      values (fid, pid, (x ->> 'type')::public.connection_type, x ->> 'why', x ->> 'title', x ->> 'org', (x ->> 'degree')::smallint,
              coalesce(x ->> 'origin', 'research'), p ->> 'request', conv_id, least(n, 9), 'suggested', who_tag)
      returning id into conn_id;
    else
      update public.connections set reason = coalesce(x ->> 'why', reason), title = coalesce(x ->> 'title', title), org = coalesce(x ->> 'org', org),
             degree = coalesce((x ->> 'degree')::smallint, degree), request = coalesce(p ->> 'request', request)
       where id = conn_id;
    end if;
    v_people := v_people || jsonb_build_object('id', conn_id, 'type', x ->> 'type', 'name', x ->> 'name', 'linkedin', x ->> 'linkedin');
    conn_id := null;
  end loop;
  if jsonb_array_length(v_people) > 0 then
    changes := changes || jsonb_build_object('what', 'people', 'action', 'suggested', 'label', jsonb_array_length(v_people) || ' people');
  end if;

  -- Follow-ups
  for x in select * from jsonb_array_elements(coalesce(p -> 'follow_ups', '[]'::jsonb)) loop
    insert into public.follow_ups (founder_id, task, due_on) values (fid, x ->> 'task', nullif(x ->> 'due', '')::date);
    changes := changes || jsonb_build_object('what', 'follow_up', 'action', 'added', 'label', x ->> 'task');
  end loop;

  select * into f from public.founders where id = fid;
  v_result := jsonb_build_object(
    'saved', true, 'capture_id', cap_id, 'slug', f.slug,
    'company', (select name from public.companies where id = f.company_id),
    'stage', f.status, 'conversation_id', conv_id, 'people', v_people, 'changes', changes,
    'questions_for_piyush', coalesce(p -> 'questions_for_piyush', '[]'::jsonb));
  update public.captures set status = 'processed', result = v_result where id = cap_id;
  return v_result;
end $$;

revoke all on function public.save_v3(jsonb, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.save_v3(jsonb, text, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- The board snapshot carries the new fields
-- ---------------------------------------------------------------------------
create or replace function public.listing_json(p_id uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select to_jsonb(f) - 'private_notes' - 'notion_page_id' - 'owner_id' - 'created_at' - 'archived_at'
    || jsonb_build_object(
      'company', (select jsonb_build_object('id', c.id, 'name', c.name, 'one_liner', c.one_liner, 'website', c.website)
                  from public.companies c where c.id = f.company_id),
      'team', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'position', t.position, 'role', t.role,
                  'person', jsonb_build_object('id', p.id, 'full_name', p.full_name, 'first_name', p.first_name,
                                               'phone', p.phone, 'email', p.email, 'linkedin_url', p.linkedin_url))
                  order by t.position)
                from public.founder_team t join public.people p on p.id = t.person_id where t.founder_id = f.id), '[]'::jsonb),
      'source_ids', coalesce((select jsonb_agg(fs.source_id order by fs.created_at) from public.founder_sources fs where fs.founder_id = f.id), '[]'::jsonb),
      'connections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'reason', c.reason,
                  'title', c.title, 'org', c.org, 'rank', c.rank, 'status', c.status, 'degree', c.degree, 'origin', c.origin,
                  'request', c.request, 'created_at', c.created_at,
                  'person', jsonb_build_object('id', p.id, 'full_name', p.full_name, 'first_name', p.first_name,
                            'title', p.title, 'org', p.org, 'linkedin_url', p.linkedin_url))
                  order by c.type, c.rank)
                from public.connections c join public.people p on p.id = c.person_id
                where c.founder_id = f.id and c.archived_at is null), '[]'::jsonb),
      'conversation_count', (select count(*) from public.conversations cv where cv.founder_id = f.id and cv.archived_at is null))
  from public.founders f where f.id = p_id;
$$;
