// Bazooka's agent tools. One definition, served two ways:
//   REST: POST /api/agent { tool, args }   (GET /api/agent lists them)
//   MCP:  POST /api/mcp  (JSON-RPC, Streamable HTTP, stateless)
// Each tool declares the scope it needs. Members have every scope; agents have the scopes the
// admin gave their token. Writes are attributed to the caller in activity_log and can be undone.
// Agents never see private_notes and never delete anything.

import { db, must, HttpError } from './supabase.js';
import { runIngest } from './capture.js';
import { renderAll } from './templates.js';
import { autofillListing } from './autofill.js';
import { waitUntil } from '@vercel/functions';

// submit_capture answers within this time; if the AI is slower the capture keeps processing in the
// background and the agent checks back with get_capture. Most agents give up on calls after ~60 s.
const CAPTURE_WAIT_MS = 40000;
import { FOUNDER_STATUSES, CONNECTION_TYPES } from './capture-schema.js';

const FOUNDER_SELECT = `slug, status, stage, raise_clause, needs, founder_highlight, recent_signal, strategy_topic, advice_topic,
  source_event, met_on, conviction, customer_tick, bucket_reason, note, verify, updated_at,
  lane:lanes(slug, name, bucket:buckets(slug, name)),
  person:people(full_name, first_name, linkedin_url, email, phone),
  company:companies(name, one_liner, website),
  founder_sources(source:sources(slug, name))`;

const str = (d, max = 300) => ({ type: 'string', maxLength: max, description: d });
const shape = (f) => f && ({
  slug: f.slug,
  name: f.person?.full_name || f.person?.first_name || null,
  company: f.company?.name || null,
  one_liner: f.company?.one_liner || null,
  lane: f.lane?.slug || null,
  bucket: f.lane?.bucket?.slug || null,
  status: f.status,
  sources: (f.founder_sources || []).map((s) => s.source?.slug).filter(Boolean),
  stage: f.stage, needs: f.needs, customer_tick: f.customer_tick,
  needs_check: f.verify,
  ...(f.met_on !== undefined ? {
    met_on: f.met_on, source_event: f.source_event, raise_clause: f.raise_clause, founder_highlight: f.founder_highlight,
    recent_signal: f.recent_signal, strategy_topic: f.strategy_topic, advice_topic: f.advice_topic, conviction: f.conviction,
    bucket_reason: f.bucket_reason, note: f.note, contact: f.person ? { linkedin_url: f.person.linkedin_url, email: f.person.email, phone: f.person.phone } : null,
    website: f.company?.website || null, updated_at: f.updated_at,
  } : {}),
});

async function founderBySlug(sb, slug) {
  if (typeof slug !== 'string' || !slug) throw new HttpError(400, 'slug is required. Use list_founders to find it.');
  const f = must(await sb.from('founders').select('id, person_id, company_id, ' + FOUNDER_SELECT).eq('slug', slug).is('archived_at', null).maybeSingle(), 'Loading founder');
  if (!f) throw new HttpError(404, `No founder with slug "${slug}". Use list_founders to find the right one.`);
  return f;
}

function pick(obj, keys) { const o = {}; for (const k of keys) if (obj?.[k] !== undefined) o[k] = obj[k]; return o; }

export const TOOLS = [
  {
    name: 'get_overview',
    scope: 'board:read',
    description: 'Start here. Returns the month\'s targets and progress, the buckets and lanes (with slugs), the sources (with slugs), the allowed founder statuses, and counts of open follow-ups.',
    input: { type: 'object', properties: {}, additionalProperties: false },
    async run(sb) {
      const [settings, buckets, lanes, sources, founders, conns, fu] = await Promise.all([
        sb.from('settings').select('value').eq('key', 'targets').maybeSingle(),
        sb.from('buckets').select('slug, name, description').is('archived_at', null).order('position'),
        sb.from('lanes').select('slug, name, slot_target, bucket:buckets(slug)').is('archived_at', null).order('position'),
        sb.from('sources').select('slug, name, full_name, expected_count, tentative, verify').is('archived_at', null).order('position'),
        sb.from('founders').select('status, lane_id').is('archived_at', null),
        sb.from('connections').select('status').is('archived_at', null).not('person_id', 'is', null),
        sb.from('follow_ups').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      ]);
      const fs = must(founders, 'Loading founders');
      const cs = must(conns, 'Loading connections');
      const byStatus = Object.fromEntries(FOUNDER_STATUSES.map((s) => [s, fs.filter((f) => f.status === s).length]));
      return {
        targets: must(settings, 'Loading targets')?.value,
        progress: {
          founders: fs.length, unplaced_founders: fs.filter((f) => !f.lane_id).length, by_status: byStatus,
          real_connections: cs.length, intros_sent: cs.filter((c) => ['intro_sent', 'meeting_happened'].includes(c.status)).length,
          meetings: cs.filter((c) => c.status === 'meeting_happened').length, open_follow_ups: fu.count ?? 0,
        },
        buckets: must(buckets, 'Loading buckets'),
        lanes: must(lanes, 'Loading lanes').map((l) => ({ slug: l.slug, name: l.name, bucket: l.bucket?.slug, slot_target: l.slot_target })),
        sources: must(sources, 'Loading sources'),
        statuses: FOUNDER_STATUSES,
        connection_types: CONNECTION_TYPES,
      };
    },
  },
  {
    name: 'list_founders',
    scope: 'board:read',
    description: 'List founders on the board, optionally filtered. Returns short records with each founder\'s slug (use it in other tools).',
    input: {
      type: 'object', additionalProperties: false,
      properties: {
        query: str('Text to match in the founder\'s name or company', 120),
        lane: str('Lane slug', 60), bucket: str('Bucket slug', 60), source: str('Source slug', 60),
        status: { type: 'string', enum: FOUNDER_STATUSES },
        needs_check: { type: 'boolean', description: 'Only founders with fields marked "needs check"' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
    },
    async run(sb, a) {
      const rows = must(await sb.from('founders').select(FOUNDER_SELECT.replace(/source_event[^\n]*\n/, '')).is('archived_at', null).order('updated_at', { ascending: false }).limit(500), 'Loading founders');
      const q = (a.query || '').toLowerCase().trim();
      const out = rows.map(shape).filter((f) =>
        (!q || [f.name, f.company, f.one_liner].some((x) => x && x.toLowerCase().includes(q))) &&
        (!a.lane || f.lane === a.lane) && (!a.bucket || f.bucket === a.bucket) && (!a.status || f.status === a.status) &&
        (!a.source || f.sources.includes(a.source)) && (!a.needs_check || f.needs_check.length > 0));
      return { count: out.length, founders: out.slice(0, a.limit || 50).map((f) => pick(f, ['slug', 'name', 'company', 'one_liner', 'lane', 'bucket', 'status', 'sources', 'needs', 'needs_check'])) };
    },
  },
  {
    name: 'get_founder',
    scope: 'board:read',
    description: 'Everything Bazooka knows about one founder: details, the 3 suggested connections, open follow-ups and the status timeline. Private notes are never included.',
    input: { type: 'object', additionalProperties: false, required: ['slug'], properties: { slug: str('Founder slug', 80) } },
    async run(sb, a) {
      const f = await founderBySlug(sb, a.slug);
      const [conns, fu, tl] = await Promise.all([
        sb.from('connections').select('id, label, type, reason, title, org, relevance, thesis, rank, status, person:people(full_name, first_name, title, org)').eq('founder_id', f.id).is('archived_at', null).order('rank'),
        sb.from('follow_ups').select('id, task, due_on, status, outcome').eq('founder_id', f.id).order('created_at'),
        sb.from('founder_timeline').select('at, actor_label, from_status, to_status').eq('founder_id', f.id).order('at'),
      ]);
      return {
        founder: shape(f),
        connections: must(conns, 'Loading connections').map((c) => ({ id: c.id, rank: c.rank, name: c.person?.full_name || c.label, placeholder: !c.person,
          type: c.type, status: c.status, reason: c.reason, title: c.title || c.person?.title, org: c.org || c.person?.org, relevance: c.relevance, thesis: c.thesis })),
        follow_ups: must(fu, 'Loading follow-ups'),
        timeline: must(tl, 'Loading timeline'),
      };
    },
  },
  {
    name: 'submit_capture',
    scope: 'capture:write',
    description: 'Send a conversation transcript and/or Piyush\'s notes. Bazooka\'s intake AI extracts founders, needs, connections and promises, and updates the board (matching existing founders). Use this for anything Piyush tells you about a founder. Returns a summary, what changed, and up to 2 questions to ask Piyush.',
    input: {
      type: 'object', additionalProperties: false,
      properties: {
        transcript: str('The conversation or Piyush\'s words, verbatim', 200000),
        notes: str('Your short summary of the five answers (who, where, needs, who can help, promises). Mark anything private as "private".', 20000),
        external_id: str('A unique id for this message so a retry is not applied twice', 200),
      },
    },
    async run(sb, a, who) {
      let body = a, captureId = null;
      if (who.kind === 'member') {
        const { data: cap, error } = await sb.from('captures').insert({ channel: 'api', status: 'transcribed', created_by: who.member.id,
          transcript: a.transcript || '', notes_text: a.notes || '' }).select('id').single();
        if (error) throw new HttpError(500, error.message);
        body = { capture_id: cap.id }; captureId = cap.id;
      }
      const work = runIngest(who, body, { onCaptureId: (id) => { captureId = id; } });
      work.catch(() => {});   // failures are recorded on the capture; get_capture reports them
      const timer = new Promise((r) => setTimeout(() => r('slow'), CAPTURE_WAIT_MS));
      const first = await Promise.race([work, timer]);
      if (first !== 'slow') return first;
      waitUntil(work);
      return { capture_id: captureId, status: 'processing',
        message: 'Bazooka is still reading this. Tell Piyush it is being processed, then call get_capture with this capture_id in about a minute to get the summary and questions.' };
    },
  },
  {
    name: 'get_capture',
    scope: 'capture:write',
    description: 'Check a capture you sent: its status (processing, processed or failed), the summary, what changed on the board, and any questions for Piyush. Use it when submit_capture said it was still processing.',
    input: { type: 'object', additionalProperties: false, required: ['capture_id'], properties: { capture_id: { type: 'string', format: 'uuid' } } },
    async run(sb, a, who) {
      let q = sb.from('captures').select('id, status, error, result, llm_output, created_at, agent_id, created_by').eq('id', a.capture_id);
      if (who.kind === 'agent') q = q.eq('agent_id', who.agent.id);
      const c = must(await q.maybeSingle(), 'Loading capture');
      if (!c) throw new HttpError(404, 'No capture with that id was sent by you.');
      const status = c.status === 'processed' ? 'processed' : c.status === 'failed' ? 'failed' : 'processing';
      return { capture_id: c.id, status, summary: c.llm_output?.summary ?? null, result: c.result ?? null,
        ask_piyush: c.llm_output?.ask_piyush ?? [], error: status === 'failed' ? c.error : null };
    },
  },
  {
    name: 'update_founder',
    scope: 'board:write',
    description: 'Change specific fields on one founder. Only the fields you pass change. "note" is appended (dated), never replaces. "checked" removes fields from the needs-check list once a person has confirmed them. Moving to another lane = set lane.',
    input: {
      type: 'object', additionalProperties: false, required: ['slug'],
      properties: {
        slug: str('Founder slug', 80),
        status: { type: 'string', enum: FOUNDER_STATUSES },
        lane: str('Lane slug (moves the founder)', 60),
        stage: str('e.g. pre-seed, seed, Series A', 60), raise_clause: str('e.g. ", raising $2M"', 120),
        needs: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 8, description: 'Replaces the list of needs' },
        founder_highlight: str('Fragment for messages: what stood out'), recent_signal: str('Fragment: recent progress'),
        strategy_topic: str('Fragment: topic for a deeper conversation', 200), advice_topic: str('Fragment: what they need advice on', 200),
        source_event: str('Where Piyush met them', 200), met_on: str('YYYY-MM-DD', 10),
        conviction: { type: 'integer', minimum: 1, maximum: 5 }, customer_tick: { type: 'boolean' },
        company_name: str('Company name', 120), one_liner: str('What the company is building', 200), website: str('Company website', 300),
        full_name: str('Founder full name', 120), first_name: str('Founder first name', 60),
        linkedin_url: str('LinkedIn URL', 300), email: str('Email', 200), phone: str('WhatsApp number, E.164', 30),
        note: str('A dated note to append', 600),
        checked: { type: 'array', items: { type: 'string' }, description: 'Field names confirmed by a person; removes their needs-check marker' },
      },
    },
    async run(sb, a) {
      const f = await founderBySlug(sb, a.slug);
      const patch = pick(a, ['status', 'stage', 'raise_clause', 'needs', 'founder_highlight', 'recent_signal', 'strategy_topic', 'advice_topic', 'source_event', 'met_on', 'conviction', 'customer_tick']);
      if (a.met_on && !/^\d{4}-\d{2}-\d{2}$/.test(a.met_on)) throw new HttpError(400, 'met_on must be YYYY-MM-DD.');
      if (a.lane !== undefined) {
        const lane = must(await sb.from('lanes').select('id').eq('slug', a.lane).is('archived_at', null).maybeSingle(), 'Loading lane');
        if (!lane) throw new HttpError(400, `No lane "${a.lane}". get_overview lists the lanes.`);
        patch.lane_id = lane.id;
      }
      if (a.note) patch.note = [f.note, `${new Date().toISOString().slice(0, 10)}: ${a.note}`].filter(Boolean).join('\n');
      if (a.checked?.length) patch.verify = (f.verify || []).filter((x) => !a.checked.includes(x));
      const changed = [];
      if (Object.keys(patch).length) { must(await sb.from('founders').update(patch).eq('id', f.id), 'Updating founder'); changed.push(...Object.keys(patch)); }

      const co = pick({ name: a.company_name, one_liner: a.one_liner, website: a.website }, ['name', 'one_liner', 'website']);
      for (const k of Object.keys(co)) if (co[k] === undefined) delete co[k];
      if (Object.keys(co).length) {
        if (f.company_id) must(await sb.from('companies').update(co).eq('id', f.company_id), 'Updating company');
        else if (co.name) { const c = must(await sb.from('companies').insert(co).select('id').single(), 'Adding company'); must(await sb.from('founders').update({ company_id: c.id }).eq('id', f.id), 'Linking company'); }
        else throw new HttpError(400, 'This founder has no company yet; pass company_name first.');
        changed.push(...Object.keys(co).map((k) => 'company.' + k));
      }
      const pe = pick(a, ['full_name', 'first_name', 'linkedin_url', 'email', 'phone']);
      if (Object.keys(pe).length) {
        if (f.person_id) must(await sb.from('people').update(pe).eq('id', f.person_id), 'Updating person');
        else { const p = must(await sb.from('people').insert({ ...pe, tags: ['founder'] }).select('id').single(), 'Adding person'); must(await sb.from('founders').update({ person_id: p.id }).eq('id', f.id), 'Linking person'); }
        changed.push(...Object.keys(pe).map((k) => 'person.' + k));
      }
      if (!changed.length) throw new HttpError(400, 'Nothing to change. Pass at least one field besides slug.');
      return { slug: f.slug, changed };
    },
  },
  {
    name: 'add_connection',
    scope: 'board:write',
    description: 'Suggest a person from Piyush\'s network for a founder (a first customer, investor or advisor). Replaces one empty placeholder slot of the same type if there is one. Only use names Piyush gave you; never invent people.',
    input: {
      type: 'object', additionalProperties: false, required: ['slug', 'full_name', 'type'],
      properties: {
        slug: str('Founder slug', 80), full_name: str('The connection\'s full name', 120), type: { type: 'string', enum: CONNECTION_TYPES },
        reason: str('One line: why this person'), title: str('Their title', 120), org: str('Their organisation', 120),
        relevance: str('Fragment for messages: their relevant work'), thesis: str('Fragment for messages: investment focus (investors)'),
      },
    },
    async run(sb, a) {
      const f = await founderBySlug(sb, a.slug);
      let person = must(await sb.from('people').select('id').ilike('full_name', a.full_name).eq('is_placeholder', false).is('archived_at', null).limit(1).maybeSingle(), 'Finding person');
      person ||= must(await sb.from('people').insert({ full_name: a.full_name, first_name: a.full_name.split(/\s+/)[0], title: a.title, org: a.org, tags: ['network'] }).select('id').single(), 'Adding person');
      const dup = must(await sb.from('connections').select('id').eq('founder_id', f.id).eq('person_id', person.id).is('archived_at', null).maybeSingle(), 'Checking duplicates');
      if (dup) return { slug: f.slug, connection_id: dup.id, already_there: true };
      const slot = must(await sb.from('connections').select('id, rank').eq('founder_id', f.id).is('person_id', null).eq('type', a.type).is('archived_at', null).order('rank').limit(1).maybeSingle(), 'Finding a slot');
      if (slot) must(await sb.from('connections').update({ archived_at: new Date().toISOString() }).eq('id', slot.id), 'Freeing the slot');
      const maxRank = must(await sb.from('connections').select('rank').eq('founder_id', f.id).is('archived_at', null).order('rank', { ascending: false }).limit(1).maybeSingle(), 'Ranking');
      const c = must(await sb.from('connections').insert({ founder_id: f.id, person_id: person.id, type: a.type, reason: a.reason, title: a.title, org: a.org,
        relevance: a.relevance, thesis: a.thesis, rank: slot?.rank ?? Math.min(9, (maxRank?.rank || 0) + 1) }).select('id').single(), 'Adding connection');
      if (f.status === 'new') await sb.from('founders').update({ status: 'connections_suggested' }).eq('id', f.id);
      return { slug: f.slug, connection_id: c.id };
    },
  },
  {
    name: 'update_connection',
    scope: 'board:write',
    description: 'Record what happened with an intro: approved, intro_sent, meeting_happened or declined. The founder\'s status follows (intro sent -> intros_sent, meeting -> meeting_happened).',
    input: {
      type: 'object', additionalProperties: false, required: ['connection_id', 'status'],
      properties: { connection_id: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['suggested', 'approved', 'intro_sent', 'meeting_happened', 'declined'] },
        reason: str('Optional updated reason') },
    },
    async run(sb, a) {
      const c = must(await sb.from('connections').select('id, founder_id').eq('id', a.connection_id).is('archived_at', null).maybeSingle(), 'Loading connection');
      if (!c) throw new HttpError(404, 'No such connection. get_founder lists connection ids.');
      must(await sb.from('connections').update(pick(a, ['status', 'reason'])).eq('id', c.id), 'Updating connection');
      const order = FOUNDER_STATUSES;
      const target = { intro_sent: 'intros_sent', meeting_happened: 'meeting_happened' }[a.status];
      if (target) {
        const f = must(await sb.from('founders').select('id, status').eq('id', c.founder_id).single(), 'Loading founder');
        if (order.indexOf(target) > order.indexOf(f.status)) await sb.from('founders').update({ status: target }).eq('id', f.id);
      }
      return { connection_id: c.id, status: a.status };
    },
  },
  {
    name: 'list_follow_ups',
    scope: 'board:read',
    description: 'Promises and next steps (from captures or added by people), newest first.',
    input: { type: 'object', additionalProperties: false, properties: { status: { type: 'string', enum: ['open', 'done', 'skipped'], default: 'open' }, slug: str('Only this founder', 80) } },
    async run(sb, a) {
      let q = sb.from('follow_ups').select('id, task, due_on, status, outcome, created_at, founder:founders!inner(slug)').eq('status', a.status || 'open').order('due_on', { ascending: true, nullsFirst: false });
      if (a.slug) q = q.eq('founder.slug', a.slug);
      const rows = must(await q.limit(200), 'Loading follow-ups');
      return { follow_ups: rows.map((r) => ({ id: r.id, founder: r.founder.slug, task: r.task, due_on: r.due_on, status: r.status, outcome: r.outcome })) };
    },
  },
  {
    name: 'complete_follow_up',
    scope: 'board:write',
    description: 'Mark a follow-up done (or skipped) and record the outcome.',
    input: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['done', 'skipped'], default: 'done' }, outcome: str('What happened', 600) } },
    async run(sb, a) {
      const r = must(await sb.from('follow_ups').update({ status: a.status || 'done', outcome: a.outcome }).eq('id', a.id).select('id'), 'Updating follow-up');
      if (!r.length) throw new HttpError(404, 'No such follow-up. list_follow_ups gives ids.');
      return { id: a.id, status: a.status || 'done' };
    },
  },
  {
    name: 'get_messages',
    scope: 'board:read',
    description: 'The six ready-to-send messages for a founder and one of their connections (intro to customer / investor / advisor, follow-up, keep warm, deeper strategy). Blanks show as [field]; fill them with update_founder or add_connection, or let Piyush edit. Bazooka never sends messages itself.',
    input: { type: 'object', additionalProperties: false, required: ['slug'], properties: { slug: str('Founder slug', 80), connection_id: { type: 'string', format: 'uuid', description: 'Defaults to the top-ranked connection' } } },
    async run(sb, a) {
      const f = await founderBySlug(sb, a.slug);
      const [conns, templates, vars] = await Promise.all([
        sb.from('connections').select('id, label, title, org, relevance, thesis, rank, person:people(full_name, first_name, title, org)').eq('founder_id', f.id).is('archived_at', null).order('rank'),
        sb.from('templates').select('key, title, channel, subject, body').eq('active', true).order('position'),
        sb.from('variables').select('key, scope, fallback'),
      ]);
      const cs = must(conns, 'Loading connections');
      const c = a.connection_id ? cs.find((x) => x.id === a.connection_id) : cs[0];
      if (a.connection_id && !c) throw new HttpError(404, 'That connection does not belong to this founder.');
      return { slug: f.slug, connection: c ? { id: c.id, name: c.person?.full_name || c.label } : null,
        messages: renderAll(must(templates, 'Loading templates'), f, c, must(vars, 'Loading variables')) };
    },
  },
  {
    name: 'fill_blanks',
    scope: 'board:write',
    description: 'Ask Bazooka\'s AI to fill a company\'s empty message fields (what stood out, recent signal, advice and strategy topics, connection reasons) from what Bazooka already knows. Never overwrites existing values. Call it after adding details, then get_messages.',
    input: { type: 'object', additionalProperties: false, required: ['slug'], properties: { slug: str('Company slug', 80) } },
    async run(sb, a, who) {
      const f = await founderBySlug(sb, a.slug);
      return autofillListing(who, f.id);
    },
  },
  {
    name: 'recent_activity',
    scope: 'board:read',
    description: 'What changed recently on the board and who changed it (people and agents).',
    input: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } } },
    async run(sb, a) {
      const rows = must(await sb.from('activity_log').select('at, actor_type, actor_label, action, table_name, changed, after, before')
        .in('table_name', ['founders', 'connections', 'follow_ups', 'sources', 'people', 'companies']).order('id', { ascending: false }).limit(a.limit || 20), 'Loading activity');
      return { activity: rows.map((r) => { const j = r.after || r.before || {};
        return { at: r.at, by: r.actor_label, by_type: r.actor_type, action: r.action, what: r.table_name, label: j.full_name || j.name || j.slug || j.task || null, changed: r.changed }; }) };
    },
  },
];

const BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
const ALL_SCOPES = ['board:read', 'board:write', 'capture:write'];

export function toolsFor(who) {
  const scopes = who.kind === 'member' ? ALL_SCOPES : who.agent.scopes;
  return TOOLS.filter((t) => scopes.includes(t.scope));
}

// Light argument check against the tool's schema (types, enums, required, unknown keys).
function check(tool, args) {
  const s = tool.input;
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new HttpError(400, 'args must be an object.');
  for (const k of s.required || []) if (args[k] === undefined || args[k] === null || args[k] === '') throw new HttpError(400, `${k} is required.`);
  for (const [k, v] of Object.entries(args)) {
    const p = s.properties?.[k];
    if (!p) throw new HttpError(400, `Unknown field "${k}". Allowed: ${Object.keys(s.properties || {}).join(', ') || 'none'}.`);
    if (v === null || v === undefined) continue;
    const t = p.type;
    const ok = t === 'string' ? typeof v === 'string' : t === 'integer' ? Number.isInteger(v) : t === 'boolean' ? typeof v === 'boolean'
      : t === 'array' ? Array.isArray(v) && v.every((x) => typeof x === 'string') : true;
    if (!ok) throw new HttpError(400, `${k} must be ${t === 'array' ? 'a list of strings' : 'a ' + t}.`);
    if (p.enum && !p.enum.includes(v)) throw new HttpError(400, `${k} must be one of: ${p.enum.join(', ')}.`);
    if (typeof v === 'string' && p.maxLength && v.length > p.maxLength) throw new HttpError(400, `${k} is too long (max ${p.maxLength}).`);
    if (p.format === 'uuid' && !/^[0-9a-f-]{36}$/i.test(v)) throw new HttpError(400, `${k} must be an id from another tool's result.`);
    if (t === 'integer' && ((p.minimum != null && v < p.minimum) || (p.maximum != null && v > p.maximum))) throw new HttpError(400, `${k} is out of range.`);
  }
}

export async function callTool(who, name, args = {}) {
  const tool = BY_NAME[name];
  if (!tool) throw new HttpError(404, `Unknown tool "${name}". Available: ${toolsFor(who).map((t) => t.name).join(', ')}.`);
  if (!toolsFor(who).includes(tool)) throw new HttpError(403, `This token does not have ${tool.scope}, which ${name} needs. Ask the Bazooka admin.`);
  check(tool, args);
  return tool.run(db(who.actor), args, who);
}
