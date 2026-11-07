// Bazooka's agent tools (bazooka-v3). One definition, served two ways:
//   REST: POST /api/agent { tool, args }   (GET /api/agent lists them)
//   MCP:  POST /api/mcp  (JSON-RPC, Streamable HTTP, stateless)
// No AI runs here: every tool is a database read or write and answers in well under a second.
// Agents do the thinking, LinkedIn research and message writing, and save results in the bazooka-v3
// format (api/_lib/schema-v3.js). Writes are logged under the caller's name and can be undone.
// Agents never see private notes and never delete companies.

import { db, must, HttpError } from './supabase.js';
import {
  SCHEMA_VERSION, STAGES, PEOPLE_TYPES, SAVE_CONVERSATION, SAVE_PEOPLE, UPDATE_COMPANY, UPDATE_PERSON, SAVE_MESSAGE,
  check, checkPeople, normLinkedin,
} from './schema-v3.js';

const STAGE_LABEL = { new: 'Met', connections_suggested: 'Connections suggested', intros_sent: 'Intros sent',
  meeting_happened: 'Meeting happened', feedback_captured: 'Feedback captured', completed: 'Completed' };
const TYPE_LABEL = { customer: 'Potential customers', investor: 'Potential investors', advisor: 'Potential advisors' };
const DEGREE = { 1: '1st', 2: '2nd', 3: '3rd' };
const CHANNEL = { grok: 'grok', instinct: 'instinct', notion: 'notion' };
const TRANSCRIPT_PREVIEW = 1500;

const obj = (properties = {}, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const str = (description, maxLength = 120) => ({ type: 'string', maxLength, description });

async function companyBySlug(sb, slug) {
  if (typeof slug !== 'string' || !slug) throw new HttpError(400, 'slug is required. get_board lists every company with its slug.');
  const f = must(await sb.from('founders').select('id, slug, company_id, status').eq('slug', slug).is('archived_at', null).maybeSingle(), 'Loading company');
  if (!f) throw new HttpError(404, `No company with slug "${slug}". get_board lists every company with its slug.`);
  return f;
}

// Run the save transaction; database rule errors come back as 400 with the exact message.
async function saveV3(sb, who, payload, kind) {
  const { data, error } = await sb.rpc('save_v3', {
    p: payload, p_kind: kind,
    p_agent: who.kind === 'agent' ? who.agent.id : null,
    p_member: who.kind === 'member' ? who.member.id : null,
    p_channel: who.kind === 'agent' ? (CHANNEL[who.agent.kind] || 'api') : 'api',
  });
  if (error) throw new HttpError(error.code === 'P0001' || error.code === '23514' ? 400 : 500, error.message);
  return data;
}

function failIf(errors) {
  if (errors.length) throw new HttpError(400, `Not saved. Fix these and send again: ${errors.slice(0, 12).join('; ')}.`);
}

function cleanLinks(p) {
  for (const x of p.founders || []) if (x.linkedin) x.linkedin = normLinkedin(x.linkedin);
  for (const x of p.people || []) if (x.linkedin) x.linkedin = normLinkedin(x.linkedin);
  return p;
}

const cardUrl = (who, slug) => `${who.origin || ''}/?company=${encodeURIComponent(slug)}`;

// A ready-to-show block for the agent's chat, so Piyush sees exactly what Bazooka now shows.
async function showPiyush(sb, who, slug, extra = {}) {
  const c = await companyDetail(sb, slug, { brief: true });
  const lines = [`Saved to Bazooka: ${c.name} (${STAGE_LABEL[c.stage] || c.stage}).`];
  if (c.where_we_are) lines.push(`Where we are: ${c.where_we_are}`);
  const needs = PEOPLE_TYPES.filter((t) => c.needs[t]).map((t) => `${t}: ${c.needs[t]}`);
  if (needs.length) lines.push(`Needs: ${needs.join('; ')}`);
  for (const t of PEOPLE_TYPES) {
    const ps = c.people.filter((p) => p.type === t && p.status !== 'declined');
    if (!ps.length) continue;
    lines.push(`${TYPE_LABEL[t]}:`);
    for (const p of ps) {
      const role = [p.title, p.org].filter(Boolean).join(' at ');
      lines.push(`- ${p.name}${role ? `, ${role}` : ''}${p.degree ? ` (${DEGREE[p.degree]})` : ''}: ${p.why || ''}${p.linkedin ? ` ${p.linkedin}` : ' (not found on LinkedIn)'}${p.status !== 'suggested' ? ` [${p.status.replace('_', ' ')}]` : ''}`);
    }
  }
  if (extra.questions?.length) lines.push(`Questions: ${extra.questions.join(' ')}`);
  lines.push(`Card: ${cardUrl(who, slug)}`);
  return lines.join('\n');
}

function fillPrompt(t, v) { return t.replace(/\{(\w+)\}/g, (_, k) => (v[k] ? String(v[k]) : `[${k}]`)); }

async function companyDetail(sb, slug, { brief = false, fullTranscripts = false } = {}) {
  const f = await companyBySlug(sb, slug);
  const [lj, conv, msgs, fu, tpl, sp, lanes] = await Promise.all([
    sb.rpc('listing_json', { p_id: f.id }),
    brief ? { data: [] } : sb.from('conversations').select('id, happened_on, title, summary, transcript, origin, created_at').eq('founder_id', f.id).is('archived_at', null).order('happened_on', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }),
    brief ? { data: [] } : sb.from('drafts').select('id, connection_id, template_key, channel, subject, rendered_text, status, approved_at, sent_at, updated_at').eq('founder_id', f.id).neq('status', 'discarded').order('created_at', { ascending: false }),
    brief ? { data: [] } : sb.from('follow_ups').select('id, task, due_on, status, outcome').eq('founder_id', f.id).order('created_at'),
    brief ? { data: [] } : sb.from('templates').select('key, title, channel, recipient, subject, body').eq('active', true).order('position'),
    brief ? { data: null } : sb.from('settings').select('value').eq('key', 'search_prompts').maybeSingle(),
    sb.from('lanes').select('id, slug, name, bucket:buckets(slug, name)'),
  ]);
  const l = must(lj, 'Loading company');
  const lane = must(lanes, 'Loading domains').find((x) => x.id === l.lane_id);
  const srcs = l.source_ids.length ? must(await sb.from('sources').select('id, slug, name').in('id', l.source_ids), 'Loading sources') : [];
  const needs = { customer: l.need_customer || null, investor: l.need_investor || null, advisor: l.need_advisor || null };
  const founders = l.team.map((t) => ({ name: t.person.full_name, role: t.role, linkedin: t.person.linkedin_url }));
  const out = {
    slug: l.slug, name: l.company?.name || null, one_liner: l.company?.one_liner || null, website: l.company?.website || null,
    domain: lane ? { slug: lane.slug, name: lane.name } : null, bucket: lane?.bucket?.slug || null,
    sources: srcs.map((x) => ({ slug: x.slug, name: x.name })),
    stage: l.status, round: l.round, met_on: l.met_on, where_we_are: l.where_we_are, needs, founders,
    people: l.connections.map((c) => ({ id: c.id, type: c.type, name: c.person.full_name, linkedin: c.person.linkedin_url,
      title: c.title || c.person.title, org: c.org || c.person.org, why: c.reason, degree: c.degree, status: c.status,
      origin: c.origin, request: c.request, suggested_at: c.created_at })),
  };
  if (brief) return out;
  const first = founders[0]?.name?.split(/\s+/)[0] || null;
  const values = { company: out.name, one_liner: out.one_liner, round: out.round, need: null, domain: lane?.name, founders: founders.map((x) => x.name).join(', '), where_we_are: out.where_we_are };
  const prompts = must(sp, 'Loading search prompts')?.value || {};
  return {
    ...out,
    conversations: must(conv, 'Loading conversations').map((c) => ({ id: c.id, date: c.happened_on, title: c.title, summary: c.summary,
      transcript: fullTranscripts || (c.transcript || '').length <= TRANSCRIPT_PREVIEW ? c.transcript : c.transcript.slice(0, TRANSCRIPT_PREVIEW) + ' …',
      transcript_chars: (c.transcript || '').length, origin: c.origin })),
    messages: must(msgs, 'Loading messages').map((m) => ({ id: m.id, person_id: m.connection_id, guide: m.template_key, channel: m.channel,
      subject: m.subject, text: m.rendered_text, status: m.status, approved_at: m.approved_at, sent_at: m.sent_at })),
    follow_ups: must(fu, 'Loading follow-ups').map((x) => ({ id: x.id, task: x.task, due: x.due_on, status: x.status, outcome: x.outcome })),
    guides: must(tpl, 'Loading message guides'),
    guide_values: { founder_first_name: first, company: out.name, one_liner: out.one_liner, round: out.round },
    search_prompts: Object.fromEntries(PEOPLE_TYPES.map((t) => [t, { needed: !!needs[t], prompt: prompts[t] ? fillPrompt(prompts[t], { ...values, need: needs[t] }) : null }])),
    card_url: null,
  };
}

export const TOOLS = [
  {
    name: 'get_board',
    scope: 'board:read',
    description: 'Start here. The whole board in one call: every company (slug, name, founders, domain, sources, stage, where we are, needs, people counts), the domains, buckets, sources and stages. Use the slugs in other tools.',
    input: obj(),
    async run(sb) {
      const d = must(await sb.rpc('board_snapshot'), 'Loading the board');
      const lane = Object.fromEntries(d.lanes.map((l) => [l.id, l]));
      const bucket = Object.fromEntries(d.buckets.map((b) => [b.id, b]));
      const src = Object.fromEntries(d.sources.map((x) => [x.id, x]));
      const companies = d.listings.map((l) => {
        const count = (t) => l.connections.filter((c) => c.type === t && c.status !== 'declined').length;
        return { slug: l.slug, name: l.company?.name || null, one_liner: l.company?.one_liner || null,
          founders: l.team.map((t) => t.person.full_name), domain: lane[l.lane_id]?.slug || null, bucket: bucket[lane[l.lane_id]?.bucket_id]?.slug || null,
          sources: l.source_ids.map((id) => src[id]?.slug).filter(Boolean), stage: l.status, round: l.round || null, where_we_are: l.where_we_are || null,
          needs: { customer: l.need_customer || null, investor: l.need_investor || null, advisor: l.need_advisor || null },
          people: { customer: count('customer'), investor: count('investor'), advisor: count('advisor') },
          conversations: l.conversation_count, updated_at: l.updated_at };
      });
      return {
        schema: SCHEMA_VERSION, guide: '/AGENTS.md', stages: STAGES,
        buckets: d.buckets.map((b) => ({ slug: b.slug, name: b.name, description: b.description })),
        domains: d.lanes.map((l) => ({ slug: l.slug, name: l.name, bucket: bucket[l.bucket_id]?.slug })),
        sources: d.sources.map((x) => ({ slug: x.slug, name: x.name, companies: companies.filter((c) => c.sources.includes(x.slug)).length })),
        companies,
      };
    },
  },
  {
    name: 'get_company',
    scope: 'board:read',
    description: 'One company in full: details, founders (LinkedIn), needs, where we are, people suggested (with ids and status), conversations, messages, follow-ups, the six message guides, and the LinkedIn search prompts already filled in for this company. Private notes are never included. Transcripts are cut to 1,500 characters unless full_transcripts is true.',
    input: obj({ slug: str('The company\'s slug', 80), full_transcripts: { type: 'boolean', description: 'Return whole transcripts' } }, ['slug']),
    async run(sb, a, who) {
      const c = await companyDetail(sb, a.slug, { fullTranscripts: !!a.full_transcripts });
      return { ...c, card_url: cardUrl(who, c.slug) };
    },
  },
  {
    name: 'save_conversation',
    scope: 'capture:write',
    description: `Save a conversation about a company in the ${SCHEMA_VERSION} format: the transcript and summary, company details, founders with LinkedIn, needs, where we are, the people you found (up to 3 per needed type), follow-ups, private note, questions. New company: company.slug null. One transaction. Returns what changed and show_piyush, a block to show Piyush in the chat.`,
    input: SAVE_CONVERSATION,
    async run(sb, a, who) {
      const p = cleanLinks(structuredClone(a));
      failIf(checkPeople(p.people, p.needs));
      const r = await saveV3(sb, who, p, 'conversation');
      return { ...r, card_url: cardUrl(who, r.slug), show_piyush: await showPiyush(sb, who, r.slug, { questions: r.questions_for_piyush }) };
    },
  },
  {
    name: 'save_people',
    scope: 'capture:write',
    description: `Save people you found for a company without a new conversation, e.g. after Piyush asks "find me 3 investors for X". ${SCHEMA_VERSION} format. Include his request in his own words, and needs for any type he asked for that the company does not have yet. Returns show_piyush.`,
    input: SAVE_PEOPLE,
    async run(sb, a, who) {
      const p = cleanLinks(structuredClone(a));
      failIf(checkPeople(p.people, p.needs));
      const r = await saveV3(sb, who, p, 'people');
      return { ...r, card_url: cardUrl(who, r.slug), show_piyush: await showPiyush(sb, who, r.slug) };
    },
  },
  {
    name: 'update_company',
    scope: 'board:write',
    description: 'Change any company field: name, one-liner, website, domain, sources (at most 2), round, met on, stage, where we are, needs, founders, follow-ups (add or mark done), private note (appended). Only the fields you send change.',
    input: UPDATE_COMPANY,
    async run(sb, a, who) {
      const p = cleanLinks(structuredClone(a));
      const f = await companyBySlug(sb, p.slug);
      const { slug, stage, follow_ups_done: done, name, one_liner, website, domain, sources, round, met_on, ...rest } = p;
      const payload = { slug, company: { name, one_liner, website, domain, sources, round, met_on }, ...rest };
      const r = await saveV3(sb, who, payload, 'update');
      if (stage) must(await sb.from('founders').update({ status: stage }).eq('id', f.id), 'Setting the stage');
      if (done?.length) must(await sb.from('follow_ups').update({ status: 'done' }).eq('founder_id', f.id).in('id', done), 'Closing follow-ups');
      const changed = Object.keys(a).filter((k) => k !== 'slug');
      return { slug: f.slug, changed, stage: stage || r.stage, card_url: cardUrl(who, f.slug) };
    },
  },
  {
    name: 'update_person',
    scope: 'board:write',
    description: 'Update one suggested person (id from get_company people[].id): status (approved when Piyush says yes, intro_sent, meeting_happened, declined), why, title, org, LinkedIn. The company stage follows.',
    input: UPDATE_PERSON,
    async run(sb, a) {
      const c = must(await sb.from('connections').select('id, person_id, founder_id').eq('id', a.id).is('archived_at', null).maybeSingle(), 'Loading person');
      if (!c) throw new HttpError(404, 'No such person. get_company lists people with their ids.');
      const patch = {};
      if (a.status) patch.status = a.status;
      if (a.why !== undefined) patch.reason = a.why;
      if (a.title !== undefined) patch.title = a.title;
      if (a.org !== undefined) patch.org = a.org;
      if (Object.keys(patch).length) {
        const { error } = await sb.from('connections').update(patch).eq('id', c.id);
        if (error) throw new HttpError(error.code === 'P0001' ? 400 : 500, error.message);
      }
      if (a.linkedin) must(await sb.from('people').update({ linkedin_url: normLinkedin(a.linkedin) }).eq('id', c.person_id), 'Saving LinkedIn');
      return { id: c.id, changed: Object.keys(a).filter((k) => k !== 'id') };
    },
  },
  {
    name: 'save_message',
    scope: 'board:write',
    description: 'Record a message you wrote from a guide: draft (shown to Piyush), approved (he said yes), sent (it went out). Send message_id to move an existing message along. A sent intro marks that person as intro sent and moves the company to "Intros sent". Bazooka never sends anything itself.',
    input: SAVE_MESSAGE,
    async run(sb, a) {
      const f = await companyBySlug(sb, a.slug);
      if (a.person_id) {
        const c = must(await sb.from('connections').select('id').eq('id', a.person_id).eq('founder_id', f.id).maybeSingle(), 'Checking person');
        if (!c) throw new HttpError(400, 'person_id is not one of this company\'s people. get_company lists them.');
      }
      const now = new Date().toISOString();
      const row = {};
      if (a.person_id !== undefined) row.connection_id = a.person_id;
      if (a.guide !== undefined) row.template_key = a.guide || null;
      if (a.channel !== undefined) row.channel = a.channel;
      if (a.subject !== undefined) row.subject = a.subject;
      if (a.text) row.rendered_text = a.text;
      row.status = a.status;
      if (a.status === 'approved') row.approved_at = now;
      if (a.status === 'sent') row.sent_at = now;
      if (row.template_key) {
        const g = must(await sb.from('templates').select('key').eq('key', row.template_key).maybeSingle(), 'Checking guide');
        if (!g) throw new HttpError(400, `No guide "${row.template_key}". get_company lists the guides.`);
      }
      let id = a.message_id;
      if (id) {
        const r = must(await sb.from('drafts').update(row).eq('id', id).eq('founder_id', f.id).select('id'), 'Updating message');
        if (!r.length) throw new HttpError(404, 'No such message for this company. get_company lists messages.');
      } else {
        if (!a.text) throw new HttpError(400, 'text is required for a new message.');
        id = must(await sb.from('drafts').insert({ founder_id: f.id, ...row }).select('id').single(), 'Saving message').id;
      }
      const after = must(await sb.from('founders').select('status').eq('id', f.id).single(), 'Loading stage');
      return { message_id: id, status: a.status, stage: after.status };
    },
  },
  {
    name: 'add_source',
    scope: 'board:write',
    description: 'Add a source (where Piyush meets founders, e.g. an accelerator, fund or event) to the board. Returns its slug. If one with the same name exists, returns that one.',
    input: obj({ name: str('Short name, e.g. "Antler"', 60), full_name: str('Full name, e.g. "Antler India demo day"', 120) }, ['name']),
    async run(sb, a) {
      const name = String(a.name || '').trim();
      if (!name) throw new HttpError(400, 'name is required.');
      const existing = must(await sb.from('sources').select('slug, name').ilike('name', name).is('archived_at', null).maybeSingle(), 'Checking sources');
      if (existing) return { slug: existing.slug, name: existing.name, already_there: true };
      let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'source';
      const taken = must(await sb.from('sources').select('slug').like('slug', `${slug}%`), 'Checking slugs').map((x) => x.slug);
      for (let i = 2; taken.includes(slug); i++) slug = `${slug.replace(/-\d+$/, '')}-${i}`;
      const last = must(await sb.from('sources').select('position').is('archived_at', null).order('position', { ascending: false }).limit(1).maybeSingle(), 'Ordering');
      must(await sb.from('sources').insert({ slug, name, full_name: a.full_name || null, kind: 'other', position: (last?.position ?? -1) + 1 }), 'Adding source');
      return { slug, name };
    },
  },
  {
    name: 'remove_source',
    scope: 'board:write',
    description: 'Remove a source from the board. If companies still use it, Bazooka refuses and lists them, unless detach is true (then it is taken off those companies too). Undoable by a person.',
    input: obj({ slug: str('The source slug', 60), detach: { type: 'boolean', description: 'Also take it off the companies that use it' } }, ['slug']),
    async run(sb, a) {
      const s = must(await sb.from('sources').select('id, slug, name').eq('slug', a.slug).is('archived_at', null).maybeSingle(), 'Loading source');
      if (!s) throw new HttpError(404, `No source "${a.slug}". get_board lists the sources.`);
      const used = must(await sb.from('founder_sources').select('founder:founders!inner(slug, archived_at)').eq('source_id', s.id), 'Checking companies')
        .filter((x) => !x.founder.archived_at).map((x) => x.founder.slug);
      if (used.length && !a.detach) throw new HttpError(400, `${s.name} is still used by ${used.length} compan${used.length === 1 ? 'y' : 'ies'}: ${used.join(', ')}. Move them with update_company, or send detach: true.`);
      if (used.length) must(await sb.from('founder_sources').delete().eq('source_id', s.id), 'Detaching');
      must(await sb.from('sources').update({ archived_at: new Date().toISOString() }).eq('id', s.id), 'Removing source');
      return { removed: s.slug, detached_from: used };
    },
  },
  {
    name: 'recent_activity',
    scope: 'board:read',
    description: 'What changed recently and who changed it (people and agents).',
    input: obj({ limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 20' } }),
    async run(sb, a) {
      const rows = must(await sb.from('activity_log').select('at, actor_type, actor_label, action, table_name, changed, after, before')
        .in('table_name', ['founders', 'companies', 'connections', 'conversations', 'drafts', 'follow_ups', 'sources', 'people'])
        .order('id', { ascending: false }).limit(a.limit || 20), 'Loading activity');
      const what = { founders: 'company', companies: 'company', connections: 'person', conversations: 'conversation', drafts: 'message', follow_ups: 'follow-up', sources: 'source', people: 'person' };
      return { activity: rows.map((r) => { const j = r.after || r.before || {};
        return { at: r.at, by: r.actor_label, by_type: r.actor_type, action: r.action, what: what[r.table_name], label: j.full_name || j.name || j.title || j.slug || j.task || null, changed: r.changed }; }) };
    },
  },
];

const BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
const ALL_SCOPES = ['board:read', 'board:write', 'capture:write'];

export function toolsFor(who) {
  const scopes = who.kind === 'member' ? ALL_SCOPES : who.agent.scopes;
  return TOOLS.filter((t) => scopes.includes(t.scope));
}

export async function callTool(who, name, args = {}) {
  const tool = BY_NAME[name];
  if (!tool) throw new HttpError(404, `Unknown tool "${name}". Available: ${toolsFor(who).map((t) => t.name).join(', ')}. Read /AGENTS.md.`);
  if (!toolsFor(who).includes(tool)) throw new HttpError(403, `This token does not have ${tool.scope}, which ${name} needs. Ask the Bazooka admin.`);
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new HttpError(400, 'args must be an object.');
  failIf(check(tool.input, args));
  return tool.run(db(who.actor), args, who);
}
