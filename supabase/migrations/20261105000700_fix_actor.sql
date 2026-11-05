-- Fix: inside a SECURITY DEFINER function current_user is the owner, so service-role requests
-- were never recognised and agent/member writes made by server functions were logged as "System".
-- Read the request's role from PostgREST's JWT claims instead.
create or replace function public.current_actor() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  a      text := nullif(current_setting('bazooka.actor', true), '');
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  h      text;
begin
  if a is not null then
    return a::jsonb;                       -- set by an RPC (apply_capture) for this transaction
  end if;
  if uid is not null then
    return jsonb_build_object('type', 'member', 'id', uid::text,
      'label', coalesce((select full_name from public.members where id = uid), 'Unknown member'));
  end if;
  if coalesce(claims ->> 'role', '') = 'service_role' then
    h := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-bazooka-actor';
    if h is not null and h ~ '^agent:[a-z0-9_-]+$' then
      return jsonb_build_object('type', 'agent', 'id', split_part(h, ':', 2),
        'label', coalesce((select name from public.agents where slug = split_part(h, ':', 2)), split_part(h, ':', 2)));
    end if;
    if h is not null and h ~ '^member:[0-9a-f-]{36}$' then
      return jsonb_build_object('type', 'member', 'id', split_part(h, ':', 2),
        'label', coalesce((select full_name from public.members where id = split_part(h, ':', 2)::uuid), 'Member'));
    end if;
  end if;
  return jsonb_build_object('type', 'system', 'id', null, 'label', 'System');
end $$;

-- Don't log "agent used its token" timestamps; they are noise, not changes.
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
    where k not in ('updated_at', 'last_used_at') and (a -> k) is distinct from (b -> k);
    if diff is null then return new; end if;
  end if;

  rid := coalesce(coalesce(a, b) ->> 'id', coalesce(a, b) ->> 'key',
                  (coalesce(a, b) ->> 'founder_id') || ':' || (coalesce(a, b) ->> 'source_id'));

  insert into public.activity_log (actor_type, actor_id, actor_label, action, table_name, row_id, changed, before, after, capture_id)
  values ((actor ->> 'type')::public.actor_type, actor ->> 'id', actor ->> 'label',
          lower(tg_op), tg_table_name, rid, diff, b, a, cap);
  return coalesce(new, old);
end $$;
