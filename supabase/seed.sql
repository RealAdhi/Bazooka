-- Seed: the whiteboard as of 2026-11-05. Placeholder data only (no real contact details,
-- no real connection names). Safe to run once on an empty database.

-- Settings ------------------------------------------------------------------
insert into public.settings (key, value) values
  ('targets',      '{"month": "November 2026", "founders": 25, "connections": 50, "meetings": 25}'),
  ('llm',          '{"order": ["notion", "grok", "selected"], "selected": "gemini",
                     "models": {"gemini": "gemini-flash-latest", "claude": "claude-sonnet-5-5", "grok": "grok-4"},
                     "notion_available": false}'),
  ('transcription','{"provider": "azure", "locale": "en-IN", "diarize": true, "max_speakers": 6}');

-- Sources -------------------------------------------------------------------
insert into public.sources (slug, name, full_name, kind, expected_count, tentative, group_key, verify, position) values
  ('ef',        'EF',         'Entrepreneur First', 'program',   5,    false, null,         false, 1),
  ('variance',  'Variance',   null,                 'fund',      5,    false, null,         false, 2),
  ('localhost', 'Local Host', null,                 'community', null, true,  null,         false, 3),
  ('activate',  'Activate',   null,                 'program',   null, false, null,         false, 4),
  ('antler',    'Antler',     null,                 'program',   null, false, 'antler_spc', false, 5),
  ('spc',       'SPC',        'South Park Commons', 'community', null, false, 'antler_spc', false, 6),
  ('bloomberg', 'Bloomberg',  'Bloomberg event',    'event',     null, false, null,         false, 7),
  ('miraqules', 'Miraqules',  null,                 'other',     null, false, null,         true,  8),
  ('tbd',       'Source TBD', 'Not on the board yet', 'other',   null, false, null,         false, 99);

-- Buckets and lanes -----------------------------------------------------------
insert into public.buckets (slug, name, description, ink, position) values
  ('ecosystem', 'Ecosystem: add value',          'Add value. No direct InMobi link needed.',                              'blue',  1),
  ('moonshot',  'Moonshot #1: InMobi / Glance',  'Directly relevant to InMobi or Glance, or the agentic-AI next S-curve.', 'red',   2),
  ('unlock',    'Unlock / Learning',             'Help founders grow into more compelling, conscious founders.',          'green', 3);

insert into public.lanes (slug, bucket_id, name, slot_target, note, position)
select v.slug, b.id, v.name, v.slots, v.note, v.pos
from (values
  ('bio',           'ecosystem', 'Bio-Science',       5, null,                                                                  1),
  ('ai_native',     'ecosystem', 'AI-native',         5, null,                                                                  2),
  ('space',         'ecosystem', 'Space',             3, 'Met space founders at the Outside-In session. Names to come.',       3),
  ('defence',       'ecosystem', 'Defence',           1, 'Open lane',                                                           4),
  ('inmobi_glance', 'moonshot',  'InMobi / Glance',   5, null,                                                                  5),
  ('unlock',        'unlock',    'Unlock / Learning', 4, null,                                                                  6)
) as v(slug, bucket, name, slots, note, pos)
join public.buckets b on b.slug = v.bucket;

-- Founders --------------------------------------------------------------------
-- (slug, person first name, person full name, company, one_liner, lane, sources, source_event, status, customer_tick, verify, note, needs)
create temp table _f (slug text, first_name text, full_name text, company text, one_liner text, lane text,
                      sources text[], source_event text, status public.founder_status, tick boolean,
                      verify text[], note text, needs text[], pos int);
insert into _f values
  ('popvax',        null,     null,          'PopVax',        'Personalised cancer vaccines', 'bio',           '{bloomberg}',   'the Bloomberg event', 'connections_suggested', false, '{}',                   'Piyush has met them in person.', '{}', 1),
  ('mandrake',      null,     null,          'Mandrake',      null, 'bio',           '{antler}',      null, 'new', false, '{}',                   null, '{}', 2),
  ('locksmith-bio', null,     null,          'Locksmith Bio', null, 'bio',           '{activate,ef}', null, 'new', false, '{}',                   'Came through two sources: Activate and EF.', '{}', 3),
  ('alpha-grid',    null,     null,          'Alpha-Grid',    null, 'bio',           '{variance}',    null, 'new', false, '{}',                   null, '{}', 4),
  ('sabir',         'Sabir',  'Sabir',       null,            null, 'bio',           '{miraqules}',   null, 'new', false, '{source_ids}',         null, '{}', 5),
  ('tarini',        'Tarini', 'Tarini',      'Detective AI',  null, 'ai_native',     '{tbd}',         null, 'new', false, '{company}',            'Board reads "Detectify". Wants Piyush''s reference.', '{A reference from Piyush}', 1),
  ('robocare',      'Ayush',  'Ayush',       'Robocare',      null, 'ai_native',     '{tbd}',         null, 'new', false, '{first_name}',         null, '{}', 2),
  ('amit-sharma',   'Amit',   'Amit Sharma', null,            null, 'ai_native',     '{tbd}',         null, 'new', false, '{display_name}',       'Faint on the board.', '{}', 3),
  ('kunal',         'Kunal',  'Kunal',       'Keshav',        null, 'ai_native',     '{tbd}',         null, 'new', false, '{first_name,company}', 'Both names are faint on the board.', '{}', 4),
  ('prava',         null,     null,          'Prava',         null, 'inmobi_glance', '{tbd}',         null, 'meeting_happened', true, '{}',           'Connected. InMobi became the first customer.', '{}', 1),
  ('aina',          null,     null,          'Aina',          null, 'inmobi_glance', '{tbd}',         null, 'new', false, '{}',                   null, '{}', 2),
  ('vinat',         null,     null,          'Vinat',         null, 'inmobi_glance', '{tbd}',         null, 'new', false, '{company}',            null, '{}', 3),
  ('turiam',        null,     null,          'Turiam',        null, 'inmobi_glance', '{tbd}',         null, 'meeting_happened', true, '{}',           'InMobi was the first customer.', '{}', 4),
  ('code-yogi',     null,     null,          'Code Yogi',     null, 'unlock',        '{tbd}',         null, 'new', false, '{}',                   null, '{}', 1),
  ('lamehouse',     null,     null,          'Lamehouse',     null, 'unlock',        '{tbd}',         null, 'new', false, '{company}',            'Could be "Lanehouse".', '{}', 2),
  ('muzo',          null,     null,          'MUZO',          null, 'unlock',        '{tbd}',         null, 'new', false, '{company}',            null, '{}', 3);

insert into public.companies (name, one_liner)
select company, one_liner from _f where company is not null;

insert into public.people (full_name, first_name, tags)
select full_name, first_name, '{founder}' from _f where first_name is not null;

insert into public.founders (slug, person_id, company_id, lane_id, position, status, needs, source_event,
                             customer_tick, verify, note)
select f.slug,
       (select p.id from public.people p where p.full_name = f.full_name limit 1),
       (select c.id from public.companies c where c.name = f.company limit 1),
       l.id, f.pos, f.status, f.needs, f.source_event, f.tick, f.verify, f.note
from _f f join public.lanes l on l.slug = f.lane;

insert into public.founder_sources (founder_id, source_id, is_primary)
select fo.id, s.id, s.slug = f.sources[1]
from _f f
join public.founders fo on fo.slug = f.slug
cross join lateral unnest(f.sources) as src(slug)
join public.sources s on s.slug = src.slug;

-- Three placeholder connection slots per founder (never real people).
insert into public.connections (founder_id, label, type, reason, rank, status, org, suggested_by)
select fo.id, 'Potential ' || t.letter, t.type, t.reason, t.rank,
       case when fo.slug in ('prava', 'turiam') and t.letter = 'customer' then 'meeting_happened'::public.connection_status else 'suggested' end,
       case when fo.slug in ('prava', 'turiam') and t.letter = 'customer' then 'InMobi' end,
       'seed'
from public.founders fo
cross join (values
  ('customer', 'customer'::public.connection_type, 'Could become an early customer or design partner.', 1),
  ('investor', 'investor'::public.connection_type, 'Invests at this stage and the thesis fits.',         2),
  ('advisor', 'advisor'::public.connection_type,  'Has built in this space and can sharpen the plan.',  3)
) as t(letter, type, reason, rank);

drop table _f;

-- Templates -------------------------------------------------------------------
insert into public.templates (key, title, channel, recipient, subject, body, position) values
  ('intro_customer', 'Intro: first customer', 'WhatsApp group', 'group',
   'Intro: {{founder_first_name|}} ({{company}}) and {{connection_first_name}}',
   E'Guys, quick intro.\n{{connection_first_name}}, meet {{founder_first_name}}. They''re building {{company}}: {{one_liner}}. We met at {{source_event}}.\n{{founder_first_name}}, {{connection_first_name}} is {{connection_title}} at {{connection_org}}. Given their work on {{connection_relevance}}, I think {{company}} could be really useful there, maybe as an early customer or design partner.\nI''ll let you two take it from here.\nPiyush', 1),
  ('intro_investor', 'Intro: investor', 'WhatsApp group or email', 'group',
   'Connecting you two: {{company}} and {{connection_org}}',
   E'Guys, connecting you two.\n{{connection_first_name}}, {{founder_first_name}} is building {{company}}: {{one_liner}}. They''re at {{stage}}{{raise_clause|}}. What stood out to me: {{founder_highlight}}.\nI think it fits your focus on {{connection_thesis}}.\n{{founder_first_name}}, {{connection_first_name}} is {{connection_title}} at {{connection_org}}.\nOver to you both.\nPiyush', 2),
  ('intro_advisor', 'Intro: advisor or expert', 'WhatsApp group', 'group',
   'An intro I''ve been meaning to make',
   E'Guys, an intro I''ve been meaning to make.\n{{connection_first_name}}, {{founder_first_name}} at {{company}} is working on {{one_liner}} and could use a sharp view on {{advice_topic}}. Nobody I know understands this better than you.\n{{founder_first_name}}, {{connection_first_name}} is {{connection_title}} at {{connection_org}}.\nPiyush', 3),
  ('follow_up', 'Follow-up: how did it go?', 'WhatsApp', 'founder',
   'How did it go with {{connection_first_name}}?',
   'Hi {{founder_first_name}}, how did it go with {{connection_first_name}}? Did anything useful come out of it? Even a one-line reply helps me make better intros next time.', 4),
  ('keep_warm', 'Keep warm, offer help', 'LinkedIn', 'founder',
   'Thinking about {{company}}',
   E'Hi {{founder_first_name}}, was thinking about {{company}} after we met at {{source_event}}. Saw {{recent_signal|the progress you''re making}}, great to see.\nIf something is blocking you right now, tell me and I''ll see who can help.', 5),
  ('deeper_strategy', 'Deeper strategy conversation', 'Email', 'founder',
   '30 minutes on {{strategy_topic}}?',
   E'Hi {{founder_first_name}}, I kept coming back to {{strategy_topic}} after our chat. There may be a real overlap with what we''re doing at {{inmobi_unit|InMobi and Glance}}.\nUp for a 30-minute deeper conversation in the next couple of weeks? {{scheduling_note|Happy to work around your time.}}\nPiyush', 6);

-- Variable registry -------------------------------------------------------------
insert into public.variables (key, label, scope, source_path, fill_strategy, fallback, hint, position) values
  ('founder_first_name',    'Founder first name',    'founder',    'people.first_name',      'direct', null, null, 1),
  ('company',               'Company',               'founder',    'companies.name',         'direct', null, null, 2),
  ('one_liner',             'What they''re building', 'founder',   'companies.one_liner',    'direct', null, null, 3),
  ('source_event',          'Where you met',         'founder',    'founders.source_event',  'direct', null, null, 4),
  ('stage',                 'Stage',                 'founder',    'founders.stage',         'direct', null, 'e.g. seed', 5),
  ('raise_clause',          'Raise (optional)',      'founder',    'founders.raise_clause',  'direct', '',   'e.g. , raising $2M', 6),
  ('founder_highlight',     'What stood out',        'founder',    'founders.founder_highlight', 'llm', null, null, 7),
  ('advice_topic',          'Advice topic',          'founder',    'founders.advice_topic',  'llm',    null, null, 8),
  ('recent_signal',         'Recent signal',         'founder',    'founders.recent_signal', 'llm',    'the progress you''re making', null, 9),
  ('strategy_topic',        'Strategy topic',        'founder',    'founders.strategy_topic','llm',    null, null, 10),
  ('connection_first_name', 'Their first name',      'connection', 'people.first_name',      'direct', null, null, 11),
  ('connection_title',      'Title',                 'connection', 'connections.title',      'direct', null, null, 12),
  ('connection_org',        'Organisation',          'connection', 'connections.org',        'direct', null, null, 13),
  ('connection_relevance',  'Relevant work',         'connection', 'connections.relevance',  'llm',    null, null, 14),
  ('connection_thesis',     'Investment focus',      'connection', 'connections.thesis',     'llm',    null, null, 15),
  ('inmobi_unit',           'InMobi unit',           'meta',       null,                     'manual', 'InMobi and Glance', null, 16),
  ('scheduling_note',       'Scheduling note',       'meta',       null,                     'manual', 'Happy to work around your time.', null, 17);

-- Agents (no tokens yet; the admin mints them) -----------------------------------
insert into public.agents (slug, name, kind, scopes, enabled) values
  ('grok-piyush', 'Piyush''s Grok bot', 'grok',     '{capture:write,board:read,board:write}', false),
  ('instinct',    'Instinct',           'instinct', '{capture:write,board:read,board:write}', false),
  ('notion-ai',   'Notion AI',          'notion',   '{capture:write,board:read,board:write}', false),
  ('research',    'Research agent',     'research', '{board:read}',               false);
