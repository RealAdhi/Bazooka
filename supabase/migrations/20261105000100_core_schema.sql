-- Bazooka core schema
-- Conventions: uuid ids, slugs for human-readable keys, created_at/updated_at,
-- soft delete via archived_at, notion_page_id where a record will mirror Notion.
-- Every table has RLS. Every change to a main table is written to activity_log by trigger.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.member_role       as enum ('admin', 'member');
create type public.founder_status    as enum ('new', 'connections_suggested', 'intros_sent', 'meeting_happened', 'feedback_captured');
create type public.connection_type   as enum ('customer', 'investor', 'advisor', 'other');
create type public.connection_status as enum ('suggested', 'approved', 'intro_sent', 'meeting_happened', 'declined');
create type public.capture_channel   as enum ('web', 'grok', 'instinct', 'notion', 'api');
create type public.capture_status    as enum ('recording', 'uploaded', 'transcribing', 'transcribed', 'processing', 'processed', 'failed');
create type public.actor_type        as enum ('member', 'agent', 'system');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at fresh
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Members: the four invited users. id = auth.users.id
-- ---------------------------------------------------------------------------
create table public.members (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  email       text not null unique,
  role        public.member_role not null default 'member',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Security-definer helpers so RLS policies don't recurse into members' own policy.
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.id = auth.uid() and m.active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.id = auth.uid() and m.active and m.role = 'admin');
$$;

-- ---------------------------------------------------------------------------
-- Board structure (editable in the playground)
-- ---------------------------------------------------------------------------
create table public.sources (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9_-]+$'),
  name           text not null,
  full_name      text,
  kind           text check (kind in ('program', 'fund', 'event', 'community', 'person', 'other')),
  expected_count integer check (expected_count >= 0),
  tentative      boolean not null default false,
  group_key      text,
  verify         boolean not null default false,
  position       double precision not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz
);

create table public.buckets (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9_-]+$'),
  name        text not null,
  description text,
  ink         text not null default 'blue' check (ink in ('blue', 'red', 'green', 'black')),
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

create table public.lanes (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9_-]+$'),
  bucket_id   uuid not null references public.buckets (id),
  name        text not null,
  slot_target integer not null default 0 check (slot_target >= 0),
  note        text,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

-- ---------------------------------------------------------------------------
-- People and companies (founders and Piyush's network share `people`)
-- ---------------------------------------------------------------------------
create table public.people (
  id             uuid primary key default gen_random_uuid(),
  full_name      text,
  first_name     text,
  headline       text,           -- e.g. "Partner at X"
  title          text,
  org            text,           -- free-text org until it's a company row
  linkedin_url   text,
  email          text,
  phone          text,           -- WhatsApp number, E.164
  city           text,
  tags           text[] not null default '{}',   -- 'founder', 'network', 'investor', ...
  is_placeholder boolean not null default false,  -- true = invented label, never a real person
  notion_page_id text,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz
);

create table public.companies (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  one_liner      text,
  website        text,
  stage          text,
  notion_page_id text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz
);

-- ---------------------------------------------------------------------------
-- Founders: the main tracked record (one founder, at one company, on the board)
-- ---------------------------------------------------------------------------
create table public.founders (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique check (slug ~ '^[a-z0-9_-]+$'),
  person_id         uuid references public.people (id),
  company_id        uuid references public.companies (id),
  lane_id           uuid references public.lanes (id),   -- null = inbox / not yet placed
  position          double precision not null default 0,
  status            public.founder_status not null default 'new',
  stage             text,
  raise_clause      text,
  needs             text[] not null default '{}',
  founder_highlight text,
  recent_signal     text,
  strategy_topic    text,
  advice_topic      text,
  source_event      text,
  met_on            date,
  conviction        smallint check (conviction between 1 and 5),
  customer_tick     boolean not null default false,
  bucket_reason     text,
  note              text,
  private_notes     text,           -- never used in any draft
  verify            text[] not null default '{}',   -- field names marked "needs check"
  owner_id          uuid references public.members (id),
  notion_page_id    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  archived_at       timestamptz,
  constraint founder_has_identity check (person_id is not null or company_id is not null)
);
create index founders_lane_idx on public.founders (lane_id, position) where archived_at is null;

create table public.founder_sources (
  founder_id uuid not null references public.founders (id) on delete cascade,
  source_id  uuid not null references public.sources (id),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (founder_id, source_id)
);

-- ---------------------------------------------------------------------------
-- Connections, templates, variables, drafts, follow-ups
-- ---------------------------------------------------------------------------
create table public.connections (
  id           uuid primary key default gen_random_uuid(),
  founder_id   uuid not null references public.founders (id) on delete cascade,
  person_id    uuid references public.people (id),  -- null while it's a placeholder slot
  label        text,                                 -- e.g. "Connection A" for placeholders
  type         public.connection_type not null,
  reason       text,
  title        text,          -- overrides person.title for this intro
  org          text,          -- overrides person.org
  relevance    text,
  thesis       text,
  rank         smallint not null default 1 check (rank between 1 and 9),
  fit          numeric(3,2) check (fit between 0 and 1),
  closeness    numeric(3,2) check (closeness between 0 and 1),
  stature      numeric(3,2) check (stature between 0 and 1),
  status       public.connection_status not null default 'suggested',
  suggested_by text,          -- 'member:<id>', 'agent:<slug>', 'capture:<id>'
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz
);
create index connections_founder_idx on public.connections (founder_id, rank);

create table public.templates (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique check (key ~ '^[a-z0-9_]+$'),
  title      text not null,
  channel    text not null,
  recipient  text not null check (recipient in ('group', 'founder', 'connection')),
  subject    text,
  body       text not null,
  active     boolean not null default true,
  position   double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Variable registry: one row per {{variable}} used in templates and prompts.
create table public.variables (
  key             text primary key check (key ~ '^[a-z0-9_]+$'),
  label           text not null,
  scope           text not null check (scope in ('founder', 'connection', 'meta')),
  source_path     text,          -- where Bazooka reads it, e.g. 'companies.one_liner'
  notion_property text,          -- the Notion property it maps to (future)
  fill_strategy   text not null default 'manual' check (fill_strategy in ('direct', 'notion', 'llm', 'manual')),
  fallback        text,
  hint            text,
  position        double precision not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.drafts (
  id            uuid primary key default gen_random_uuid(),
  founder_id    uuid not null references public.founders (id) on delete cascade,
  connection_id uuid references public.connections (id) on delete cascade,
  template_key  text not null references public.templates (key),
  overrides     jsonb not null default '{}',
  rendered_text text,
  status        text not null default 'draft' check (status in ('draft', 'sent', 'discarded')),
  sent_at       timestamptz,
  sent_by       uuid references public.members (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.follow_ups (
  id            uuid primary key default gen_random_uuid(),
  founder_id    uuid not null references public.founders (id) on delete cascade,
  connection_id uuid references public.connections (id) on delete cascade,
  task          text,          -- what was promised / what to check
  due_on        date,
  status        text not null default 'open' check (status in ('open', 'done', 'skipped')),
  outcome       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Agents (Grok bot, Instinct, Notion AI, research) — tokens stored hashed
-- ---------------------------------------------------------------------------
create table public.agents (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9_-]+$'),
  name         text not null,
  kind         text not null check (kind in ('grok', 'instinct', 'notion', 'research', 'other')),
  token_hash   text unique,      -- sha256 hex of the bearer token; the token itself is shown once
  token_prefix text,             -- first characters, to recognise it in the admin panel
  scopes       text[] not null default '{capture:write,board:read}',
  enabled      boolean not null default true,
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Captures: one recorded conversation or note, from any interface
-- ---------------------------------------------------------------------------
create table public.captures (
  id               uuid primary key default gen_random_uuid(),
  channel          public.capture_channel not null default 'web',
  status           public.capture_status not null default 'recording',
  created_by       uuid references public.members (id),
  agent_id         uuid references public.agents (id),
  external_id      text,          -- the sender's own message id, so a retried agent call isn't applied twice
  audio_path       text,          -- storage path in bucket 'captures'
  audio_mime       text,
  audio_seconds    numeric(8,1),
  transcript       text,
  utterances       jsonb,         -- speaker-split transcript from Deepgram
  notes_text       text,          -- Piyush's added thoughts (typed or transcribed)
  notes_audio_path text,
  llm_provider     text,
  llm_model        text,
  llm_output       jsonb,         -- the validated JSON the LLM returned
  result           jsonb,         -- what was applied: [{action, table, id, label}]
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint capture_has_author check (created_by is not null or agent_id is not null)
);
create index captures_recent_idx on public.captures (created_at desc);
create unique index captures_external_idx on public.captures (agent_id, external_id) where external_id is not null;

-- ---------------------------------------------------------------------------
-- Settings and LLM usage
-- ---------------------------------------------------------------------------
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.llm_usage (
  id            bigint generated always as identity primary key,
  capture_id    uuid references public.captures (id) on delete set null,
  provider      text not null,
  model         text not null,
  purpose       text not null,
  input_tokens  integer,
  output_tokens integer,
  ok            boolean not null default true,
  created_at    timestamptz not null default now()
);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['members','sources','buckets','lanes','people','companies','founders',
                           'connections','templates','variables','drafts','follow_ups','agents','captures']
  loop
    execute format('create trigger %I_touch before update on public.%I
                    for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;
