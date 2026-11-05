-- Private storage bucket for capture audio. Files go browser -> Supabase directly
-- (never through Vercel). Path convention: <capture_id>/<main|notes>-<timestamp>.<ext>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('captures', 'captures', false, 524288000,   -- 500 MB; the project-wide upload limit must also allow this
        array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/aac'])
on conflict (id) do nothing;

create policy captures_members_read on storage.objects for select to authenticated
  using (bucket_id = 'captures' and public.is_member());
create policy captures_members_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'captures' and public.is_member());
create policy captures_members_update on storage.objects for update to authenticated
  using (bucket_id = 'captures' and public.is_member());
create policy captures_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'captures' and public.is_admin());
