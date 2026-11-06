-- Invite list: who may join, and with which role. When Supabase Auth creates a user whose
-- email is on this list, they become a member automatically. Anyone else who somehow gets
-- an auth account (sign-ups should be off) is not a member and sees nothing (RLS).

create table public.invites (
  email      text primary key check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  full_name  text not null,
  role       public.member_role not null default 'member',
  invited_by uuid references public.members (id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.invites enable row level security;
create policy invites_admin on public.invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create trigger invites_audit after insert or update or delete on public.invites
  for each row execute function public.audit_row();

-- row id for the log is the email
create or replace function public.audit_strip(t text, j jsonb) returns jsonb
language sql immutable as $$
  select case t
    when 'agents'   then j - 'token_hash'
    when 'captures' then j - 'transcript' - 'utterances' - 'llm_output' - 'notes_text'
    when 'invites'  then j || jsonb_build_object('id', j ->> 'email')
    else j end;
$$;

create or replace function public.accept_invite() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv public.invites;
begin
  select * into inv from public.invites where email = lower(new.email);
  if found then
    perform set_config('bazooka.actor', jsonb_build_object('type', 'system', 'id', null, 'label', 'Invite accepted')::text, true);
    insert into public.members (id, full_name, email, role)
    values (new.id, inv.full_name, lower(new.email), inv.role)
    on conflict (id) do update set active = true, role = excluded.role;
    update public.invites set accepted_at = now() where email = inv.email;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.accept_invite();

-- Also covers the case where the auth user already existed before the invite was added.
create or replace function public.link_existing_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = new.email;
  if uid is not null then
    insert into public.members (id, full_name, email, role)
    values (uid, new.full_name, new.email, new.role)
    on conflict (id) do update set active = true, role = excluded.role, full_name = excluded.full_name;
    new.accepted_at := now();
  end if;
  return new;
end $$;

create trigger invites_link_existing before insert on public.invites
  for each row execute function public.link_existing_user();

-- First admin.
insert into public.invites (email, full_name, role)
values ('adhithya.sriram@glance.com', 'Adhithya', 'admin')
on conflict (email) do nothing;
