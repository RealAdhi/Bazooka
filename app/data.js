// dataSource: the only place the browser talks to Supabase or the API.
// Pages import what they need from here. Everything returns plain data or throws an Error
// whose message is safe to show to the user.

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';

let sb = null;
let ready = null;

async function client() {
  if (sb) return sb;
  ready ||= (async () => {
    const res = await fetch('/api/config', { cache: 'no-store' }).catch(() => null);
    if (!res || !res.ok) throw new Error('Could not reach the Bazooka server. Check your connection and reload.');
    const cfg = await res.json();
    if (!cfg.configured) throw new Error('Bazooka is not connected to its database yet. Ask the admin to add the Supabase settings.');
    const { createClient } = await import(SUPABASE_ESM);
    sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return sb;
  })();
  return ready;
}

const fail = (error, what) => { if (error) throw new Error(`${what}: ${error.message}`); };

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const auth = {
  async session() {
    const s = await client();
    const { data } = await s.auth.getSession();
    return data.session;
  },
  async onChange(fn) {
    const s = await client();
    return s.auth.onAuthStateChange((event, session) => fn(event, session));
  },
  async signIn(email, password) {
    const s = await client();
    const { error } = await s.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw new Error(/invalid/i.test(error.message) ? 'That email and password don\'t match. Try again, or email yourself a sign-in link.' : error.message);
  },
  async sendLink(email) {
    const s = await client();
    const { error } = await s.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/login.html?next=set-password` },
    });
    if (error) throw new Error(/not found|signups not allowed/i.test(error.message) ? 'That email isn\'t on the Bazooka team. Ask the admin for an invite.' : error.message);
  },
  async setPassword(password) {
    const s = await client();
    const { error } = await s.auth.updateUser({ password });
    fail(error, 'Could not save your password');
  },
  async signOut() {
    const s = await client();
    await s.auth.signOut();
  },
  // The signed-in member, or null if signed out / not on the team.
  async me() {
    const s = await client();
    const { data } = await s.auth.getSession();
    if (!data.session) return null;
    const { data: m, error } = await s.from('members').select('id, full_name, email, role, active').eq('id', data.session.user.id).maybeSingle();
    if (error || !m || !m.active) return { notMember: true, email: data.session.user.email };
    return m;
  },
};

// Gate a page: returns the member, or sends the visitor to the login page.
export async function requireMember({ admin = false } = {}) {
  const m = await auth.me();
  if (!m || m.notMember) {
    location.replace(`/login.html?back=${encodeURIComponent(location.pathname + location.hash)}${m?.notMember ? '&reason=not-member' : ''}`);
    return new Promise(() => {});   // never resolves; the page is navigating away
  }
  if (admin && m.role !== 'admin') {
    location.replace('/');
    return new Promise(() => {});
  }
  return m;
}

// ---------------------------------------------------------------------------
// Server API (functions in /api)
// ---------------------------------------------------------------------------
export async function api(path, body) {
  const session = await auth.session();
  const res = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify(body || {}),
  }).catch(() => null);
  if (!res) throw new Error('Could not reach the Bazooka server. Check your connection and try again.');
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `The server returned an error (${res.status}). Try again.`);
  return out;
}

// ---------------------------------------------------------------------------
// Board: everything the map needs, in the shape index.html renders.
// ids are slugs so the board's code and links stay readable.
// ---------------------------------------------------------------------------
export const board = {
  async getAll() {
    const s = await client();
    const q = (p, what) => p.then(({ data, error }) => { fail(error, `Could not load ${what}`); return data; });
    const [settings, sources, buckets, lanes, founders, templates] = await Promise.all([
      q(s.from('settings').select('key, value').eq('key', 'targets'), 'settings'),
      q(s.from('sources').select('slug, name, full_name, expected_count, tentative, group_key, verify').is('archived_at', null).order('position'), 'sources'),
      q(s.from('buckets').select('slug, name, description').is('archived_at', null).order('position'), 'buckets'),
      q(s.from('lanes').select('slug, name, slot_target, note, position, bucket:buckets(slug)').is('archived_at', null).order('position'), 'lanes'),
      q(s.from('founders').select(`slug, status, stage, raise_clause, needs, founder_highlight, recent_signal, strategy_topic, advice_topic,
          source_event, met_on, customer_tick, verify, note, position,
          lane:lanes(slug), person:people(full_name, first_name, phone, email), company:companies(name, one_liner),
          founder_sources(is_primary, source:sources(slug)),
          connections(id, label, type, reason, title, org, relevance, thesis, rank, status, archived_at, person_id, person:people(full_name, first_name, title, org))`)
        .is('archived_at', null).order('position'), 'founders'),
      q(s.from('templates').select('key, title, channel, recipient, subject, body').eq('active', true).order('position'), 'templates'),
    ]);
    const targets = settings[0]?.value || {};
    return {
      meta: { month: targets.month || new Date().toLocaleString('en', { month: 'long', year: 'numeric' }),
              targets: { founders: targets.founders ?? 25, connections: targets.connections ?? 50, meetings: targets.meetings ?? 25 } },
      sources: sources.map((x) => ({ id: x.slug, name: x.name, full_name: x.full_name, expected: x.expected_count ?? undefined,
        tentative: x.tentative, group: x.group_key || undefined, verify: x.verify })),
      buckets: buckets.map((b) => ({ id: b.slug, name: b.name, description: b.description,
        lanes: lanes.filter((l) => l.bucket?.slug === b.slug).map((l) => l.slug) })),
      lanes: lanes.map((l) => ({ id: l.slug, name: l.name, slots: l.slot_target, note: l.note })),
      founders: founders.map((f) => {
        const conns = (f.connections || []).filter((c) => !c.archived_at).sort((a, b) => a.rank - b.rank);
        const src = (f.founder_sources || []).sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)).map((x) => x.source?.slug).filter(Boolean);
        return {
          id: f.slug,
          display_name: !f.company && f.person ? (f.person.full_name || f.person.first_name) : null,
          first_name: f.person?.first_name || null,
          company: f.company?.name || null, one_liner: f.company?.one_liner || null,
          lane: f.lane?.slug || null, source_ids: src.length ? src : ['tbd'],
          source_event: f.source_event, met_on: f.met_on, stage: f.stage, raise_clause: f.raise_clause, needs: f.needs || [],
          founder_highlight: f.founder_highlight, recent_signal: f.recent_signal, strategy_topic: f.strategy_topic, advice_topic: f.advice_topic,
          whatsapp: f.person?.phone || null, email: f.person?.email || null,
          status: f.status, status_dates: {}, customer_tick: f.customer_tick, verify: f.verify || [], note: f.note,
          connections: conns.map((c) => ({
            id: c.id, name: c.person?.full_name || c.label || 'Connection', type: c.type, person_id: c.person_id,
            first_name: c.person?.first_name || null, title: c.title || c.person?.title || null, org: c.org || c.person?.org || null,
            relevance: c.relevance, thesis: c.thesis, reason: c.reason,
            intro_sent: ['intro_sent', 'meeting_happened'].includes(c.status), meeting: c.status === 'meeting_happened',
            feedback: c.status === 'meeting_happened' && f.status === 'feedback_captured',
          })),
        };
      }),
      people: [],
      templates: templates.map((t) => ({ key: t.key, title: t.title, channel: t.channel, to: t.recipient, subject: t.subject, body: t.body })),
    };
  },
};

// ---------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------
const EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/aac': 'aac' };

export const captures = {
  async create() {
    const s = await client();
    const { data: u } = await s.auth.getUser();
    const { data, error } = await s.from('captures').insert({ channel: 'web', status: 'recording', created_by: u.user.id }).select('id').single();
    fail(error, 'Could not start a capture');
    return data.id;
  },
  // part: 'main' (the conversation) or 'notes' (Piyush's spoken thoughts)
  async upload(id, blob, part = 'main') {
    const s = await client();
    const type = (blob.type || 'audio/webm').split(';')[0];
    const path = `${id}/${part}-${Date.now()}.${EXT[type] || 'webm'}`;
    const { error } = await s.storage.from('captures').upload(path, blob, { contentType: type, upsert: false });
    if (error) throw new Error(/size|exceed/i.test(error.message)
      ? 'The recording is too large to upload. Split long meetings into parts of under an hour.'
      : `Could not upload the recording: ${error.message}`);
    const patch = part === 'main' ? { audio_path: path, audio_mime: type, status: 'uploaded' } : { notes_audio_path: path };
    const { error: e2 } = await s.from('captures').update(patch).eq('id', id);
    fail(e2, 'Could not save the recording');
    return path;
  },
  transcribe: (id, part = 'main') => api('transcribe', { capture_id: id, part }),
  send: (id, { transcript, notes }) => api('ingest', { capture_id: id, transcript, notes_text: notes }),
  async recent(limit = 6) {
    const s = await client();
    const { data, error } = await s.from('captures')
      .select('id, status, channel, created_at, audio_seconds, error, result, llm_output, transcript, notes_text, created_by, agent_id, members:created_by(full_name), agents:agent_id(name)')
      .order('created_at', { ascending: false }).limit(limit);
    fail(error, 'Could not load recent captures');
    return data;
  },
  async get(id) {
    const s = await client();
    const { data, error } = await s.from('captures').select('*').eq('id', id).maybeSingle();
    fail(error, 'Could not load the capture');
    return data;
  },
  async undoEntry(logId) {
    const s = await client();
    const { error } = await s.rpc('undo_activity', { p_log_id: logId });
    fail(error, 'Could not undo that change');
  },
  // Undo every board change a capture made, newest first.
  async undo(id) {
    const s = await client();
    const undoable = ['sources', 'buckets', 'lanes', 'people', 'companies', 'founders', 'founder_sources', 'connections', 'follow_ups'];
    const { data, error } = await s.from('activity_log').select('id, table_name')
      .eq('capture_id', id).is('undone_by', null).in('table_name', undoable).order('id', { ascending: false });
    fail(error, 'Could not load the changes to undo');
    for (const row of data) {
      const { error: e } = await s.rpc('undo_activity', { p_log_id: row.id });
      fail(e, 'Could not undo a change');
    }
    return data.length;
  },
};

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export const admin = {
  async members() {
    const s = await client();
    const [m, i] = await Promise.all([
      s.from('members').select('id, full_name, email, role, active, created_at').order('created_at'),
      s.from('invites').select('email, full_name, role, accepted_at, created_at').order('created_at'),
    ]);
    fail(m.error, 'Could not load members'); fail(i.error, 'Could not load invites');
    return { members: m.data, invites: i.data };
  },
  invite: (email, full_name, role) => api('admin', { action: 'invite', email, full_name, role }),
  resend: (email) => api('admin', { action: 'resend_invite', email }),
  async setMember(id, patch) {
    const s = await client();
    const { error } = await s.from('members').update(patch).eq('id', id);
    fail(error, 'Could not update the member');
  },
  async agents() {
    const s = await client();
    const { data, error } = await s.from('agents').select('slug, name, kind, scopes, enabled, token_prefix, last_used_at').order('name');
    fail(error, 'Could not load agents');
    return data;
  },
  async addAgent(name, kind, canWrite) {
    const s = await client();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'agent';
    const scopes = canWrite ? ['capture:write', 'board:read', 'board:write'] : ['board:read'];
    const { error } = await s.from('agents').insert({ slug, name, kind, scopes, enabled: false });
    if (error) throw new Error(/duplicate/i.test(error.message) ? 'An agent with that name already exists.' : `Could not add the agent: ${error.message}`);
    return slug;
  },
  async setAgentScopes(slug, canWrite) {
    const s = await client();
    const scopes = canWrite ? ['capture:write', 'board:read', 'board:write'] : ['board:read'];
    const { error } = await s.from('agents').update({ scopes }).eq('slug', slug);
    fail(error, 'Could not update the agent');
  },
  mintToken: (slug) => api('admin', { action: 'mint_token', agent_slug: slug }),
  revokeToken: (slug) => api('admin', { action: 'revoke_token', agent_slug: slug }),
  async settings() {
    const s = await client();
    const { data, error } = await s.from('settings').select('key, value');
    fail(error, 'Could not load settings');
    return Object.fromEntries(data.map((r) => [r.key, r.value]));
  },
  async saveSetting(key, value) {
    const s = await client();
    const { error } = await s.from('settings').upsert({ key, value });
    fail(error, 'Could not save the setting');
  },
  // Activity log page (newest first). filters: { table, actor, from, to }
  async log({ limit = 100, before = null, table = null, from = null, to = null } = {}) {
    const s = await client();
    let q = s.from('activity_log').select('*').order('id', { ascending: false }).limit(limit);
    if (before) q = q.lt('id', before);
    if (table) q = q.eq('table_name', table);
    if (from) q = q.gte('at', from);
    if (to) q = q.lte('at', to);
    const { data, error } = await q;
    fail(error, 'Could not load the activity log');
    return data;
  },
  // Whole log in pages of 1000, for download.
  async logAll(filters = {}) {
    const all = [];
    let before = null;
    for (;;) {
      const page = await admin.log({ ...filters, limit: 1000, before });
      all.push(...page);
      if (page.length < 1000) return all;
      before = page[page.length - 1].id;
    }
  },
  async usage(days = 30) {
    const s = await client();
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const { data, error } = await s.from('llm_usage').select('provider, model, purpose, input_tokens, output_tokens, ok, created_at').gte('created_at', since).order('created_at', { ascending: false });
    fail(error, 'Could not load usage');
    return data;
  },
};

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}
