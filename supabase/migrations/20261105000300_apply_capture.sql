-- apply_capture: turn one validated LLM result into board changes, in a single transaction.
-- Called only by server code (service role) after the JSON has been validated against
-- api/_lib/capture-schema.js. Every row it touches is logged with the capture's author.
--
-- Rules
--  * null / missing field  = "not mentioned": never overwrites what we already have
--  * arrays (needs, verify) are merged, not replaced
--  * note and private_notes are appended with the date, not replaced
--  * existing founders are matched by slug, then company name, then person full name
--  * unknown lane slug -> founder lands unplaced (lane_id null) for a human to drag in
--  * unknown source    -> created with verify = true

create or replace function public.slugify(t text) returns text
language sql immutable as $$
  select nullif(trim(both '-' from regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '-', 'g')), '');
$$;

create or replace function public.unique_slug(p_table text, p_base text) returns text
language plpgsql as $$
declare
  base text := coalesce(public.slugify(p_base), 'item');
  s    text := base;
  n    int  := 1;
  hit  boolean;
begin
  loop
    execute format('select exists (select 1 from public.%I where slug = $1)', p_table) into hit using s;
    exit when not hit;
    n := n + 1;
    s := base || '-' || n;
  end loop;
  return s;
end $$;

create or replace function public.apply_capture(p_capture_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cap        public.captures;
  actor      jsonb;
  f          jsonb;
  s          jsonb;
  c          jsonb;
  k          jsonb;
  fr         public.founders;
  v_person   uuid;
  v_company  uuid;
  v_lane     uuid;
  v_source   uuid;
  v_conn_p   uuid;
  v_rank     int;
  v_new      boolean;
  v_label    text;
  v_stamp    text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD');
  results    jsonb := '[]'::jsonb;
begin
  select * into cap from public.captures where id = p_capture_id for update;
  if not found then raise exception 'Capture % not found', p_capture_id; end if;
  if cap.status = 'processed' then raise exception 'Capture % was already applied', p_capture_id; end if;

  -- Attribute every change in this transaction to whoever made the capture.
  if cap.created_by is not null then
    actor := jsonb_build_object('type', 'member', 'id', cap.created_by::text,
               'label', coalesce((select full_name from public.members where id = cap.created_by), 'Member'));
  else
    actor := (select jsonb_build_object('type', 'agent', 'id', a.slug, 'label', a.name) from public.agents a where a.id = cap.agent_id);
  end if;
  perform set_config('bazooka.actor', actor::text, true);
  perform set_config('bazooka.capture_id', p_capture_id::text, true);

  for f in select * from jsonb_array_elements(coalesce(p_payload -> 'founders', '[]'::jsonb))
  loop
    fr := null; v_new := false;

    -- 1. find an existing founder
    if nullif(f ->> 'match_slug', '') is not null then
      select * into fr from public.founders where slug = f ->> 'match_slug' and archived_at is null;
    end if;
    if fr.id is null and nullif(f #>> '{company,name}', '') is not null then
      select fo.* into fr from public.founders fo join public.companies co on co.id = fo.company_id
       where lower(co.name) = lower(f #>> '{company,name}') and fo.archived_at is null limit 1;
    end if;
    if fr.id is null and nullif(f #>> '{person,full_name}', '') is not null then
      select fo.* into fr from public.founders fo join public.people pe on pe.id = fo.person_id
       where lower(pe.full_name) = lower(f #>> '{person,full_name}') and fo.archived_at is null limit 1;
    end if;

    -- 2. person
    v_person := fr.person_id;
    if f -> 'person' is not null and jsonb_typeof(f -> 'person') = 'object'
       and coalesce(f #>> '{person,full_name}', f #>> '{person,first_name}') is not null then
      if v_person is null then
        insert into public.people (full_name, first_name, linkedin_url, email, phone, tags)
        values (f #>> '{person,full_name}',
                coalesce(f #>> '{person,first_name}', split_part(f #>> '{person,full_name}', ' ', 1)),
                f #>> '{person,linkedin_url}', f #>> '{person,email}', f #>> '{person,phone}', '{founder}')
        returning id into v_person;
      else
        update public.people set
          full_name    = coalesce(f #>> '{person,full_name}', full_name),
          first_name   = coalesce(f #>> '{person,first_name}', first_name),
          linkedin_url = coalesce(f #>> '{person,linkedin_url}', linkedin_url),
          email        = coalesce(f #>> '{person,email}', email),
          phone        = coalesce(f #>> '{person,phone}', phone)
        where id = v_person;
      end if;
    end if;

    -- 3. company
    v_company := fr.company_id;
    if nullif(f #>> '{company,name}', '') is not null then
      if v_company is null then
        select id into v_company from public.companies where lower(name) = lower(f #>> '{company,name}') and archived_at is null limit 1;
      end if;
      if v_company is null then
        insert into public.companies (name, one_liner, website, stage)
        values (f #>> '{company,name}', f #>> '{company,one_liner}', f #>> '{company,website}', f ->> 'stage')
        returning id into v_company;
      else
        update public.companies set
          name      = coalesce(f #>> '{company,name}', name),
          one_liner = coalesce(f #>> '{company,one_liner}', one_liner),
          website   = coalesce(f #>> '{company,website}', website),
          stage     = coalesce(f ->> 'stage', stage)
        where id = v_company;
      end if;
    end if;

    if v_person is null and v_company is null then
      results := results || jsonb_build_object('action', 'skipped', 'table', 'founders', 'label', 'A founder with no name or company');
      continue;
    end if;

    -- 4. lane
    v_lane := null;
    if nullif(f ->> 'lane_slug', '') is not null then
      select id into v_lane from public.lanes where slug = f ->> 'lane_slug' and archived_at is null;
    end if;

    -- 5. founder row
    if fr.id is null then
      v_new := true;
      insert into public.founders (slug, person_id, company_id, lane_id, position, status, stage, raise_clause, needs,
                                   founder_highlight, recent_signal, strategy_topic, advice_topic, source_event, met_on,
                                   conviction, customer_tick, bucket_reason, note, private_notes, verify)
      values (public.unique_slug('founders', coalesce(f #>> '{company,name}', f #>> '{person,full_name}', f #>> '{person,first_name}')),
              v_person, v_company, v_lane,
              coalesce((select max(position) + 1 from public.founders where lane_id is not distinct from v_lane), 0),
              coalesce((f ->> 'status')::public.founder_status, 'new'),
              f ->> 'stage', f ->> 'raise_clause',
              coalesce((select array_agg(x) from jsonb_array_elements_text(f -> 'needs') x), '{}'),
              f ->> 'founder_highlight', f ->> 'recent_signal', f ->> 'strategy_topic', f ->> 'advice_topic',
              f ->> 'source_event', (f ->> 'met_on')::date, (f ->> 'conviction')::smallint,
              coalesce((f ->> 'customer_tick')::boolean, false), f ->> 'bucket_reason',
              case when nullif(f ->> 'note', '') is not null then v_stamp || ': ' || (f ->> 'note') end,
              case when nullif(f ->> 'private_notes', '') is not null then v_stamp || ': ' || (f ->> 'private_notes') end,
              coalesce((select array_agg(distinct x) from jsonb_array_elements_text(f -> 'uncertain_fields') x), '{}'))
      returning * into fr;
    else
      update public.founders set
        person_id         = coalesce(person_id, v_person),
        company_id        = coalesce(company_id, v_company),
        lane_id           = coalesce(v_lane, lane_id),
        status            = coalesce((f ->> 'status')::public.founder_status, status),
        stage             = coalesce(f ->> 'stage', stage),
        raise_clause      = coalesce(f ->> 'raise_clause', raise_clause),
        needs             = (select coalesce(array_agg(distinct x), '{}') from unnest(needs || coalesce((select array_agg(y) from jsonb_array_elements_text(f -> 'needs') y), '{}')) x),
        founder_highlight = coalesce(f ->> 'founder_highlight', founder_highlight),
        recent_signal     = coalesce(f ->> 'recent_signal', recent_signal),
        strategy_topic    = coalesce(f ->> 'strategy_topic', strategy_topic),
        advice_topic      = coalesce(f ->> 'advice_topic', advice_topic),
        source_event      = coalesce(f ->> 'source_event', source_event),
        met_on            = coalesce((f ->> 'met_on')::date, met_on),
        conviction        = coalesce((f ->> 'conviction')::smallint, conviction),
        customer_tick     = coalesce((f ->> 'customer_tick')::boolean, customer_tick),
        bucket_reason     = coalesce(f ->> 'bucket_reason', bucket_reason),
        note              = case when nullif(f ->> 'note', '') is null then note
                                 else concat_ws(E'\n', note, v_stamp || ': ' || (f ->> 'note')) end,
        private_notes     = case when nullif(f ->> 'private_notes', '') is null then private_notes
                                 else concat_ws(E'\n', private_notes, v_stamp || ': ' || (f ->> 'private_notes')) end,
        verify            = (select coalesce(array_agg(distinct x), '{}') from unnest(verify || coalesce((select array_agg(y) from jsonb_array_elements_text(f -> 'uncertain_fields') y), '{}')) x)
      where id = fr.id
      returning * into fr;
    end if;

    v_label := coalesce(f #>> '{company,name}', f #>> '{person,full_name}', f #>> '{person,first_name}', fr.slug);
    results := results || jsonb_build_object('action', case when v_new then 'created' else 'updated' end,
                                             'table', 'founders', 'id', fr.id, 'slug', fr.slug, 'label', v_label,
                                             'placed', v_lane is not null or fr.lane_id is not null);

    -- 6. sources
    for s in select * from jsonb_array_elements(coalesce(f -> 'sources', '[]'::jsonb))
    loop
      v_source := null;
      if nullif(s ->> 'slug', '') is not null then
        select id into v_source from public.sources where slug = s ->> 'slug';
      end if;
      if v_source is null and nullif(s ->> 'name', '') is not null then
        select id into v_source from public.sources where lower(name) = lower(s ->> 'name') or lower(full_name) = lower(s ->> 'name') limit 1;
        if v_source is null then
          insert into public.sources (slug, name, kind, verify, position)
          values (public.unique_slug('sources', s ->> 'name'), s ->> 'name', 'other', true,
                  coalesce((select max(position) + 1 from public.sources), 0))
          returning id into v_source;
          results := results || jsonb_build_object('action', 'created', 'table', 'sources', 'id', v_source, 'label', s ->> 'name');
        end if;
      end if;
      if v_source is not null then
        insert into public.founder_sources (founder_id, source_id, is_primary)
        values (fr.id, v_source, not exists (select 1 from public.founder_sources where founder_id = fr.id))
        on conflict do nothing;
        -- a real source replaces the "Source TBD" placeholder
        delete from public.founder_sources fs using public.sources so
         where fs.founder_id = fr.id and fs.source_id = so.id and so.slug = 'tbd' and so.id <> v_source;
      end if;
    end loop;

    -- 7. connections (people named by Piyush as able to help)
    for c in select * from jsonb_array_elements(coalesce(f -> 'connections', '[]'::jsonb))
    loop
      continue when coalesce(c ->> 'full_name', c ->> 'first_name') is null;
      v_conn_p := null;
      if nullif(c ->> 'full_name', '') is not null then
        select id into v_conn_p from public.people where lower(full_name) = lower(c ->> 'full_name') and not is_placeholder and archived_at is null limit 1;
      end if;
      if v_conn_p is null then
        insert into public.people (full_name, first_name, title, org, tags)
        values (c ->> 'full_name', coalesce(c ->> 'first_name', split_part(c ->> 'full_name', ' ', 1)), c ->> 'title', c ->> 'org', '{network}')
        returning id into v_conn_p;
      end if;
      continue when exists (select 1 from public.connections where founder_id = fr.id and person_id = v_conn_p and archived_at is null);
      -- drop one placeholder slot of the same type, if any, so the board stays at three
      update public.connections set archived_at = now()
       where id = (select cn.id from public.connections cn
                    where cn.founder_id = fr.id and cn.person_id is null and cn.archived_at is null
                      and cn.type = coalesce((c ->> 'type')::public.connection_type, 'other')
                    order by cn.rank limit 1);
      select coalesce(max(rank), 0) + 1 into v_rank from public.connections where founder_id = fr.id and archived_at is null;
      insert into public.connections (founder_id, person_id, type, reason, title, org, relevance, thesis, rank, suggested_by)
      values (fr.id, v_conn_p, coalesce((c ->> 'type')::public.connection_type, 'other'), c ->> 'reason',
              c ->> 'title', c ->> 'org', c ->> 'relevance', c ->> 'thesis', least(v_rank, 9), 'capture:' || p_capture_id);
      results := results || jsonb_build_object('action', 'created', 'table', 'connections',
                                               'label', coalesce(c ->> 'full_name', c ->> 'first_name') || ' for ' || v_label);
    end loop;

    -- 8. commitments become follow-ups
    for k in select * from jsonb_array_elements(coalesce(f -> 'commitments', '[]'::jsonb))
    loop
      continue when nullif(k ->> 'task', '') is null;
      insert into public.follow_ups (founder_id, task, due_on) values (fr.id, k ->> 'task', (k ->> 'due_on')::date);
      results := results || jsonb_build_object('action', 'created', 'table', 'follow_ups', 'label', k ->> 'task');
    end loop;
  end loop;

  update public.captures set status = 'processed', llm_output = p_payload, result = results, error = null
   where id = p_capture_id;
  return results;
end $$;

revoke execute on function public.apply_capture(uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.apply_capture(uuid, jsonb) to service_role;
