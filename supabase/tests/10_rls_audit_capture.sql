-- Behaviour tests. Each block raises an exception on failure.
\set QUIET on
\pset tuples_only on

-- Two auth users: one member (admin), one outsider
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'outsider@example.com');
insert into public.members (id, full_name, email, role)
values ('00000000-0000-0000-0000-00000000000a', 'Adhithya', 'admin@example.com', 'admin');

-- Seed counts
do $$ begin
  assert (select count(*) from public.founders) = 16, 'expected 16 seeded founders';
  assert (select count(*) from public.connections) = 48, 'expected 3 placeholder connections each';
  assert (select count(*) from public.founder_sources fs join public.founders f on f.id = fs.founder_id where f.slug = 'locksmith-bio') = 2,
         'Locksmith Bio should have two sources';
end $$;

-- RLS: anon sees nothing
set role anon;
do $$ begin
  begin
    perform count(*) from public.founders;
    raise exception 'anon should not be able to read founders';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- RLS: logged-in outsider (not a member) sees zero rows
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  assert (select count(*) from public.founders) = 0, 'non-member must see no founders';
end $$;

-- RLS: member sees and edits; edit is logged with their name
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  assert (select count(*) from public.founders) = 16, 'member must see all founders';
  update public.founders set status = 'intros_sent' where slug = 'aina';
  assert (select actor_label from public.activity_log where table_name = 'founders' and action = 'update' order by id desc limit 1) = 'Adhithya',
         'update should be attributed to the member';
  assert (select 'status' = any(changed) from public.activity_log where table_name = 'founders' and action = 'update' order by id desc limit 1),
         'changed columns should be recorded';
  assert exists (select 1 from public.founder_timeline t join public.founders f on f.id = t.founder_id
                 where f.slug = 'aina' and t.to_status = 'intros_sent'), 'timeline should show the status change';
end $$;

-- Member cannot write the log directly or delete from it
do $$ begin
  begin
    insert into public.activity_log (actor_type, action, table_name, row_id) values ('member', 'insert', 'x', 'y');
    raise exception 'member should not insert into activity_log';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.activity_log;
    raise exception 'member should not delete from activity_log';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Undo the status change
do $$ declare lid bigint; begin
  select id into lid from public.activity_log where table_name = 'founders' and action = 'update' order by id desc limit 1;
  perform public.undo_activity(lid);
  assert (select status from public.founders where slug = 'aina') = 'new', 'undo should restore the status';
  assert (select undone_by is not null from public.activity_log where id = lid), 'log entry should be marked undone';
end $$;

-- Member cannot call apply_capture directly
do $$ begin
  begin
    perform public.apply_capture(gen_random_uuid(), '{}');
    raise exception 'member should not call apply_capture';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- apply_capture as the server (service role): one new founder, one update to an existing one
insert into public.captures (id, channel, status, created_by, transcript)
values ('00000000-0000-0000-0000-0000000000c1', 'web', 'transcribed', '00000000-0000-0000-0000-00000000000a', 'test');

set role service_role;
do $$ declare r jsonb; begin
  r := public.apply_capture('00000000-0000-0000-0000-0000000000c1', $j$
  {"summary": "Met Asha from Orbitly at the Outside-In session; PopVax update.",
   "founders": [
     {"match_slug": null,
      "person": {"full_name": "Asha Rao", "first_name": "Asha"},
      "company": {"name": "Orbitly", "one_liner": "Satellite data for crop insurance"},
      "lane_slug": "space", "status": "new", "stage": "seed", "needs": ["first customers"],
      "sources": [{"slug": null, "name": "Outside-In session"}],
      "connections": [{"full_name": "Placeholder Person", "first_name": "Placeholder", "type": "customer", "reason": "Runs an insurer"}],
      "commitments": [{"task": "Send Asha the insurer intro", "due_on": "2026-11-10"}],
      "uncertain_fields": ["company"], "private_notes": "Seemed tired."},
     {"match_slug": "popvax", "status": "intros_sent", "needs": ["clinical partners"], "note": "Second call went well."}
   ],
   "ask_piyush": []}
  $j$::jsonb);
  assert jsonb_array_length(r) >= 5, 'expected several result lines, got ' || r::text;
end $$;
reset role;

do $$ begin
  assert exists (select 1 from public.founders f join public.lanes l on l.id = f.lane_id where f.slug = 'orbitly' and l.slug = 'space'),
         'Orbitly should be created in the Space lane';
  assert (select verify from public.founders where slug = 'orbitly') = '{company}', 'uncertain fields go into verify';
  assert exists (select 1 from public.sources where name = 'Outside-In session' and verify), 'unknown source is created and flagged';
  assert (select count(*) from public.connections c join public.founders f on f.id = c.founder_id
          where f.slug = 'orbitly' and c.archived_at is null) = 1, 'new founder gets one real connection';
  assert (select status from public.founders where slug = 'popvax') = 'intros_sent', 'existing founder status updated';
  assert (select 'clinical partners' = any(needs) from public.founders where slug = 'popvax'), 'needs merged';
  assert (select note like '%Piyush has met them%' and note like '%Second call went well.%' from public.founders where slug = 'popvax'),
         'notes appended, not replaced';
  assert (select count(*) from public.activity_log where capture_id = '00000000-0000-0000-0000-0000000000c1') > 0,
         'changes should carry the capture id';
  assert (select bool_and(actor_label = 'Adhithya') from public.activity_log where capture_id = '00000000-0000-0000-0000-0000000000c1'),
         'capture changes attributed to the capture author';
  assert (select status from public.captures where id = '00000000-0000-0000-0000-0000000000c1') = 'processed', 'capture marked processed';
end $$;

-- Applying the same capture twice is refused
set role service_role;
do $$ begin
  begin
    perform public.apply_capture('00000000-0000-0000-0000-0000000000c1', '{"founders": []}');
    raise exception 'second apply should fail';
  exception when raise_exception then
    if sqlerrm not like '%already applied%' then raise; end if;
  end;
end $$;
reset role;

\echo 'rls/audit/capture tests passed'
