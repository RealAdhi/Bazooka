\pset tuples_only on
-- save_v3: the one transaction behind save_conversation and save_people.
insert into public.agents (slug, name, kind) values ('t-grok', 'Test Grok', 'grok');
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select set_config('request.headers', '{"x-bazooka-actor":"agent:t-grok"}', false);

-- New company from a conversation, with founders, needs and 3 customers
do $$ declare r jsonb; ag uuid := (select id from public.agents where slug = 't-grok'); begin
  r := public.save_v3('{"schema":"bazooka-v3","external_id":"m1",
    "company":{"slug":null,"name":"Orbit Test","one_liner":"Satellite risk scores","website":"https://orbit.example","domain":"space","sources":["antler"],"round":"Seed","met_on":"2026-11-06"},
    "founders":[{"name":"Asha Test","role":"CEO","linkedin":"https://www.linkedin.com/in/asha-test"}],
    "conversation":{"date":"2026-11-06","title":"Antler demo day","summary":"Met Asha","transcript":"long text"},
    "needs":{"customer":"first three insurers"},
    "where_we_are":"Met at demo day",
    "people":[{"type":"customer","name":"P One","linkedin":"https://www.linkedin.com/in/p-one","title":"Head","org":"Ins A","why":"buys risk data","degree":1,"origin":"research"},
              {"type":"customer","name":"P Two","linkedin":"https://www.linkedin.com/in/p-two","why":"x","degree":2,"origin":"research"}],
    "follow_ups":[{"task":"Intro to P One","due":"2026-11-09"}],
    "private_note":"keep this quiet",
    "questions_for_piyush":["Which insurer first?"]}'::jsonb, 'conversation', ag, null, 'grok');
  assert r ->> 'slug' = 'orbit-test', 'slug ' || (r ->> 'slug');
  assert (r ->> 'stage') = 'connections_suggested', 'stage moves to suggested: ' || (r ->> 'stage');
  assert jsonb_array_length(r -> 'people') = 2, 'two people';
  assert (select count(*) from public.conversations c join public.founders f on f.id = c.founder_id where f.slug = 'orbit-test') = 1, 'conversation saved';
  assert (select private_notes from public.founders where slug = 'orbit-test') like '%keep this quiet', 'private note';
  assert (select count(*) from public.founder_team ft join public.founders f on f.id = ft.founder_id where f.slug = 'orbit-test') = 1, 'one founder';
  assert (select actor_label from public.activity_log where table_name = 'conversations' order by id desc limit 1) = 'Test Grok', 'logged as the agent';
  -- retry returns the first result
  r := public.save_v3('{"schema":"bazooka-v3","external_id":"m1","company":{"slug":null,"name":"Orbit Test"}}'::jsonb, 'conversation', ag, null, 'grok');
  assert (r ->> 'duplicate')::boolean, 'retry is a duplicate';
end $$;

-- Duplicate company is refused
do $$ begin
  perform public.save_v3('{"company":{"slug":null,"name":"orbit test"}}'::jsonb, 'conversation', (select id from public.agents where slug = 't-grok'), null, 'grok');
  raise exception 'should have refused the duplicate';
exception when raise_exception then
  if sqlerrm not like '%already on the board as slug "orbit-test"%' then raise; end if;
end $$;

-- People of a type the company does not need are refused
do $$ begin
  perform public.save_v3('{"slug":"orbit-test","people":[{"type":"investor","name":"I One","linkedin":"https://www.linkedin.com/in/i-one","why":"x"}]}'::jsonb, 'people', (select id from public.agents where slug = 't-grok'), null, 'grok');
  raise exception 'should have refused investors';
exception when raise_exception then
  if sqlerrm not like '%no investor need%' then raise; end if;
end $$;

-- save_people with the need: replaces unacted customer suggestions, keeps approved ones
do $$ declare r jsonb; ag uuid := (select id from public.agents where slug = 't-grok'); fid uuid := (select id from public.founders where slug = 'orbit-test'); begin
  update public.connections c set status = 'approved' from public.people p where p.id = c.person_id and p.full_name = 'P One' and c.founder_id = fid;
  r := public.save_v3('{"slug":"orbit-test","request":"space-tech investors in my 1st degree","needs":{"investor":"seed funds for space tech"},
     "people":[{"type":"investor","name":"I One","linkedin":"https://www.linkedin.com/in/i-one","why":"space fund","degree":1},
               {"type":"customer","name":"P Three","linkedin":"https://www.linkedin.com/in/p-three","why":"y"}]}'::jsonb, 'people', ag, null, 'grok');
  assert (select count(*) from public.connections where founder_id = fid and archived_at is null and type = 'customer') = 2, 'P One kept, P Two replaced by P Three';
  assert (select request from public.connections c join public.people p on p.id = c.person_id where p.full_name = 'I One') like 'space-tech%', 'request stored';
end $$;

-- Limits: 3 suggested per type, 2 sources per company
do $$ declare fid uuid := (select id from public.founders where slug = 'orbit-test'); pid uuid; begin
  for i in 1..3 loop
    insert into public.people (full_name) values ('Extra ' || i) returning id into pid;
    begin
      insert into public.connections (founder_id, person_id, type, status) values (fid, pid, 'investor', 'suggested');
    exception when raise_exception then
      if i < 3 then raise; end if;   -- 1 existing + 2 more = 3 ok; the 4th is refused
    end;
  end loop;
  assert (select count(*) from public.connections where founder_id = fid and type = 'investor' and status = 'suggested' and archived_at is null) = 3, 'capped at 3';
  insert into public.founder_sources (founder_id, source_id) values (fid, (select id from public.sources where slug = 'ef'));
  begin
    insert into public.founder_sources (founder_id, source_id) values (fid, (select id from public.sources where slug = 'spc'));
    raise exception 'third source should be refused';
  exception when raise_exception then if sqlerrm not like '%at most 2 sources%' then raise; end if;
  end;
end $$;

-- A sent intro message moves the person to intro sent and the company to intros sent
do $$ declare fid uuid := (select id from public.founders where slug = 'orbit-test'); cid uuid; begin
  select c.id into cid from public.connections c join public.people p on p.id = c.person_id where p.full_name = 'P One' and c.founder_id = fid;
  insert into public.drafts (founder_id, connection_id, template_key, status, rendered_text) values (fid, cid, 'intro_customer', 'sent', 'hi');
  assert (select status from public.connections where id = cid) = 'intro_sent', 'connection intro_sent';
  assert (select status from public.founders where id = fid) = 'intros_sent', 'company intros_sent';
end $$;
reset role;
select set_config('request.headers', '', false);
select set_config('request.jwt.claims', '', false);
\echo 'save_v3 tests passed'
