-- One company listing in the shape the board page uses.
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
      'connections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label, 'type', c.type, 'reason', c.reason,
                  'title', c.title, 'org', c.org, 'relevance', c.relevance, 'thesis', c.thesis, 'rank', c.rank, 'status', c.status,
                  'person', case when p.id is null then null else jsonb_build_object('id', p.id, 'full_name', p.full_name,
                            'first_name', p.first_name, 'title', p.title, 'org', p.org, 'linkedin_url', p.linkedin_url) end)
                  order by c.rank)
                from public.connections c left join public.people p on p.id = c.person_id
                where c.founder_id = f.id and c.archived_at is null), '[]'::jsonb))
  from public.founders f where f.id = p_id;
$$;


-- The whole board in one call (instead of seven queries). Runs with the caller's rights, so RLS applies:
-- members get everything, anyone else gets empty lists.
create or replace function public.board_snapshot() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'targets', coalesce((select value from public.settings where key = 'targets'), '{}'::jsonb),
    'sources', coalesce((select jsonb_agg(to_jsonb(s) order by s.position) from (
        select id, slug, name, full_name, kind, expected_count, tentative, group_key, verify, position
        from public.sources where archived_at is null) s), '[]'::jsonb),
    'buckets', coalesce((select jsonb_agg(to_jsonb(b) order by b.position) from (
        select id, slug, name, description, ink, position from public.buckets where archived_at is null) b), '[]'::jsonb),
    'lanes', coalesce((select jsonb_agg(to_jsonb(l) order by l.position) from (
        select id, slug, name, bucket_id, slot_target, note, position from public.lanes where archived_at is null) l), '[]'::jsonb),
    'listings', coalesce((select jsonb_agg(public.listing_json(f.id) order by f.position)
        from public.founders f where f.archived_at is null), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(to_jsonb(t) order by t.position) from (
        select key, title, channel, recipient, subject, body, position from public.templates where active) t), '[]'::jsonb),
    'variables', coalesce((select jsonb_agg(to_jsonb(v)) from (select key, label, scope, fallback from public.variables) v), '[]'::jsonb)
  );
$$;

grant execute on function public.board_snapshot() to authenticated, service_role;
grant execute on function public.listing_json(uuid) to authenticated, service_role;
