-- Board v2: six stages (adds "completed"), several founders per company, clearer connection labels.

alter type public.founder_status add value if not exists 'completed' after 'feedback_captured';

-- A company listing can have several founders.
create table public.founder_team (
  id         uuid primary key default gen_random_uuid(),
  founder_id uuid not null references public.founders (id) on delete cascade,
  person_id  uuid not null references public.people (id) on delete cascade,
  role       text,
  position   double precision not null default 0,
  created_at timestamptz not null default now(),
  unique (founder_id, person_id)
);
alter table public.founder_team enable row level security;
create policy members_all on public.founder_team for all to authenticated using (public.is_member()) with check (public.is_member());
create trigger founder_team_audit after insert or update or delete on public.founder_team for each row execute function public.audit_row();

insert into public.founder_team (founder_id, person_id, position)
select id, person_id, 0 from public.founders where person_id is not null
on conflict do nothing;

-- Keep the team in step when a listing's main person is set (captures, agents).
create or replace function public.sync_founder_team() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.person_id is not null then
    insert into public.founder_team (founder_id, person_id, position)
    values (new.id, new.person_id, coalesce((select max(position) + 1 from public.founder_team where founder_id = new.id), 0))
    on conflict (founder_id, person_id) do nothing;
  end if;
  return new;
end $$;
create trigger founders_sync_team after insert or update of person_id on public.founders
  for each row execute function public.sync_founder_team();

-- "Connection A/B/C" placeholders become "Potential customer/investor/advisor".
update public.connections set label = 'Potential ' || type::text where person_id is null and label like 'Connection %';

-- Undo also covers founder_team.
create or replace function public.undo_activity(p_log_id bigint) returns bigint
language plpgsql security invoker set search_path = public as $$
declare
  l       public.activity_log;
  cols    text;
  new_id  bigint;
  allowed text[] := array['sources','buckets','lanes','people','companies','founders','founder_sources',
                          'connections','templates','variables','drafts','follow_ups','founder_team'];
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
  update public.activity_log set undone_by = new_id where id = p_log_id;   -- allowed: see policy below
  return new_id;
end $$;
