-- Activity log (append-only), audit triggers, undo, and row-level security.

-- ---------------------------------------------------------------------------
-- Activity log
-- ---------------------------------------------------------------------------
create table public.activity_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_type  public.actor_type not null,
  actor_id    text,
  actor_label text,
  action      text not null check (action in ('insert', 'update', 'delete', 'undo')),
  table_name  text not null,
  row_id      text not null,
  changed     text[],          -- columns that changed (updates only)
  before      jsonb,
  after       jsonb,
  capture_id  uuid,            -- set when the change came from a capture
  undone_by   bigint references public.activity_log (id)
);
create index activity_log_row_idx on public.activity_log (table_name, row_id, at desc);
create index activity_log_at_idx  on public.activity_log (at desc);

-- Who is acting right now?
--  1. a logged-in member (auth.uid())
--  2. an RPC that set bazooka.actor for this transaction (captures, agents)
--  3. a server function using the service key, identified by the x-bazooka-actor header
--  4. otherwise 'system'
create or replace function public.current_actor() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  a   text := nullif(current_setting('bazooka.actor', true), '');
  h   text;
begin
  if uid is not null then
    return jsonb_build_object('type', 'member', 'id', uid::text,
      'label', coalesce((select full_name from public.members where id = uid), 'Unknown member'));
  end if;
  if a is not null then
    return a::jsonb;
  end if;
  if current_user = 'service_role' then
    h := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-bazooka-actor';
    if h is not null and h ~ '^agent:[a-z0-9_-]+$' then
      return jsonb_build_object('type', 'agent', 'id', split_part(h, ':', 2), 'label', split_part(h, ':', 2));
    end if;
  end if;
  return jsonb_build_object('type', 'system', 'id', null, 'label', 'System');
end $$;

-- Columns never copied into the log (secrets, or too large to be useful there).
create or replace function public.audit_strip(t text, j jsonb) returns jsonb
language sql immutable as $$
  select case t
    when 'agents'   then j - 'token_hash'
    when 'captures' then j - 'transcript' - 'utterances' - 'llm_output' - 'notes_text'
    else j end;
$$;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor   jsonb := public.current_actor();
  b       jsonb;
  a       jsonb;
  rid     text;
  diff    text[];
  cap     uuid := nullif(current_setting('bazooka.capture_id', true), '')::uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then b := public.audit_strip(tg_table_name, to_jsonb(old)); end if;
  if tg_op in ('UPDATE', 'INSERT') then a := public.audit_strip(tg_table_name, to_jsonb(new)); end if;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into diff
    from jsonb_object_keys(a) k
    where k <> 'updated_at' and (a -> k) is distinct from (b -> k);
    if diff is null then return new; end if;   -- nothing but updated_at changed
  end if;

  rid := coalesce(coalesce(a, b) ->> 'id', coalesce(a, b) ->> 'key',
                  (coalesce(a, b) ->> 'founder_id') || ':' || (coalesce(a, b) ->> 'source_id'));

  insert into public.activity_log (actor_type, actor_id, actor_label, action, table_name, row_id, changed, before, after, capture_id)
  values ((actor ->> 'type')::public.actor_type, actor ->> 'id', actor ->> 'label',
          lower(tg_op), tg_table_name, rid, diff, b, a, cap);

  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['members','sources','buckets','lanes','people','companies','founders','founder_sources',
                           'connections','templates','variables','drafts','follow_ups','agents','captures','settings']
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                    for each row execute function public.audit_row()', t, t);
  end loop;
end $$;

-- Timeline of status changes per founder (read through RLS of the caller).
create view public.founder_timeline with (security_invoker = true) as
select row_id::uuid             as founder_id,
       at,
       actor_type,
       actor_label,
       before ->> 'status'      as from_status,
       after  ->> 'status'      as to_status,
       capture_id
from public.activity_log
where table_name = 'founders'
  and (action = 'insert' or (action = 'update' and 'status' = any (changed)));

-- ---------------------------------------------------------------------------
-- Undo: restore a logged change. Runs with the caller's rights (RLS applies).
-- ---------------------------------------------------------------------------
create or replace function public.undo_activity(p_log_id bigint) returns bigint
language plpgsql security invoker set search_path = public as $$
declare
  l       public.activity_log;
  cols    text;
  new_id  bigint;
  allowed text[] := array['sources','buckets','lanes','people','companies','founders','founder_sources',
                          'connections','templates','variables','drafts','follow_ups'];
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

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  -- Shared workspace tables: every active member can read and write everything.
  foreach t in array array['sources','buckets','lanes','people','companies','founders','founder_sources',
                           'connections','templates','variables','drafts','follow_ups','captures']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy members_all on public.%I for all to authenticated
                    using (public.is_member()) with check (public.is_member())', t);
  end loop;
end $$;

alter table public.members enable row level security;
create policy members_read  on public.members for select to authenticated using (public.is_member());
create policy members_admin on public.members for all    to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.agents enable row level security;
create policy agents_admin on public.agents for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.settings enable row level security;
create policy settings_read  on public.settings for select to authenticated using (public.is_member());
create policy settings_admin on public.settings for all    to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.llm_usage enable row level security;
create policy llm_usage_admin on public.llm_usage for select to authenticated using (public.is_admin());

-- Log: members read it (timelines); nobody inserts or deletes directly (triggers do);
-- the only permitted update is marking an entry as undone.
alter table public.activity_log enable row level security;
create policy log_read on public.activity_log for select to authenticated using (public.is_member());
create policy log_mark_undone on public.activity_log for update to authenticated
  using (public.is_member() and undone_by is null) with check (public.is_member());
revoke insert, delete, truncate on public.activity_log from anon, authenticated;
revoke update on public.activity_log from anon, authenticated;
grant update (undone_by) on public.activity_log to authenticated;

-- Anonymous visitors get nothing at all.
revoke all on all tables in schema public from anon;
