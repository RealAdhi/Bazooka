// dataSource: the only place the browser talks to Supabase or the API.
// Pages import what they need from here. Everything returns plain data or throws an Error
// whose message is safe to show to the user.

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';

let sb = null;
let ready = null;

async function client() {
  if (sb) return sb;
  ready ||= (async () => {
    // The public config rarely changes: use the saved copy at once and refresh it in the background,
    // so a page load doesn't wait for a server function to start.
    let cfg = null;
    try { cfg = JSON.parse(localStorage.getItem('bz-config') || 'null'); } catch {}
    const fetched = fetch('/api/config', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((c) => { if (c?.configured) { try { localStorage.setItem('bz-config', JSON.stringify(c)); } catch {} } return c; });
    if (!cfg?.configured) cfg = await fetched;
    if (!cfg) throw new Error('Could not reach the Bazooka server. Check your connection and reload.');
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
    if (error) throw new Error(/invalid/i.test(error.message) ? 'That email and password don\'t match. Check them and try again, or ask the admin.' : error.message);
  },
  async signOut() {
    const s = await client();
    try { localStorage.removeItem('bz-board-v2'); } catch {}
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
// Board: companies (listings), sources, buckets, lanes. Every write here is logged by the
// database with the signed-in member's name and can be undone from the admin page.
// ---------------------------------------------------------------------------
const LISTING_SELECT = `id, slug, lane_id, position, status, stage, raise_clause, needs, founder_highlight, recent_signal,
  strategy_topic, advice_topic, source_event, met_on, conviction, customer_tick, verify, note, company_id, person_id, updated_at,
  company:companies(id, name, one_liner, website),
  founder_team(id, position, role, person:people(id, full_name, first_name, phone, email)),
  founder_sources(source_id),
  connections(id, label, type, reason, title, org, relevance, thesis, rank, status, archived_at, person:people(id, full_name, first_name, title, org))`;

function shapeListing(f) {
  return {
    ...f,
    team: (f.founder_team || []).sort((a, b) => a.position - b.position),
    source_ids: (f.founder_sources || []).map((x) => x.source_id),
    connections: (f.connections || []).filter((c) => !c.archived_at).sort((a, b) => a.rank - b.rank),
  };
}

const slugify = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'company';

export const board = {
  async load() {
    const s = await client();
    const q = (p, what) => p.then(({ data, error }) => { fail(error, `Could not load ${what}`); return data; });
    const [settings, sources, buckets, lanes, listings, templates, variables] = await Promise.all([
      q(s.from('settings').select('key, value').eq('key', 'targets'), 'settings'),
      q(s.from('sources').select('id, slug, name, full_name, kind, expected_count, tentative, group_key, verify, position').is('archived_at', null).order('position'), 'sources'),
      q(s.from('buckets').select('id, slug, name, description, ink, position').is('archived_at', null).order('position'), 'buckets'),
      q(s.from('lanes').select('id, slug, name, bucket_id, slot_target, note, position').is('archived_at', null).order('position'), 'domains'),
      q(s.from('founders').select(LISTING_SELECT).is('archived_at', null).order('position'), 'companies'),
      q(s.from('templates').select('key, title, channel, recipient, subject, body').eq('active', true).order('position'), 'templates'),
      q(s.from('variables').select('key, label, scope, fallback'), 'variables'),
    ]);
    return { targets: settings[0]?.value || {}, sources, buckets, lanes, listings: listings.map(shapeListing), templates, variables };
  },
  async listing(id) {
    const s = await client();
    const { data, error } = await s.from('founders').select(LISTING_SELECT).eq('id', id).maybeSingle();
    fail(error, 'Could not load the company');
    return data && shapeListing(data);
  },
  async updateListing(id, patch) {
    const s = await client();
    const { error } = await s.from('founders').update(patch).eq('id', id);
    fail(error, 'Could not save');
  },
  async updateCompany(listing, patch) {
    const s = await client();
    if (listing.company_id) {
      const { error } = await s.from('companies').update(patch).eq('id', listing.company_id);
      return fail(error, 'Could not save');
    }
    const { data, error } = await s.from('companies').insert({ name: patch.name || 'Untitled company', ...patch }).select('id').single();
    fail(error, 'Could not save');
    await board.updateListing(listing.id, { company_id: data.id });
  },
  async addFounder(listingId, fullName) {
    const s = await client();
    const name = fullName.trim();
    const { data: p, error } = await s.from('people').insert({ full_name: name, first_name: name.split(/\s+/)[0], tags: ['founder'] }).select('id').single();
    fail(error, 'Could not add the founder');
    const { data: pos } = await s.from('founder_team').select('position').eq('founder_id', listingId).order('position', { ascending: false }).limit(1);
    const { error: e2 } = await s.from('founder_team').insert({ founder_id: listingId, person_id: p.id, position: (pos?.[0]?.position ?? -1) + 1 });
    fail(e2, 'Could not add the founder');
    const { data: l } = await s.from('founders').select('person_id').eq('id', listingId).single();
    if (!l.person_id) await board.updateListing(listingId, { person_id: p.id });
  },
  async removeFounder(teamId) {
    const s = await client();
    const { error } = await s.from('founder_team').delete().eq('id', teamId);
    fail(error, 'Could not remove the founder');
  },
  async renamePerson(personId, fullName) {
    const s = await client();
    const name = fullName.trim();
    const { error } = await s.from('people').update({ full_name: name, first_name: name.split(/\s+/)[0] }).eq('id', personId);
    fail(error, 'Could not save the name');
  },
  async setSources(listingId, sourceIds) {
    const s = await client();
    const { data: cur, error } = await s.from('founder_sources').select('source_id').eq('founder_id', listingId);
    fail(error, 'Could not load sources');
    const have = new Set(cur.map((x) => x.source_id)), want = new Set(sourceIds);
    const add = [...want].filter((x) => !have.has(x)), del = [...have].filter((x) => !want.has(x));
    if (add.length) fail((await s.from('founder_sources').insert(add.map((source_id, i) => ({ founder_id: listingId, source_id, is_primary: !have.size && i === 0 })))).error, 'Could not add the source');
    if (del.length) fail((await s.from('founder_sources').delete().eq('founder_id', listingId).in('source_id', del)).error, 'Could not remove the source');
  },
  // Save a new order: ids in display order. Only rows whose position changes are written.
  async reorder(table, ids, current = {}) {
    const s = await client();
    for (let i = 0; i < ids.length; i++) {
      if (current[ids[i]] === i) continue;
      const { error } = await s.from(table).update({ position: i }).eq('id', ids[i]);
      fail(error, 'Could not save the new order');
    }
  },
  async addListing({ laneId, companyName, founderName, oneLiner, sourceId }) {
    const s = await client();
    const { data: co, error } = await s.from('companies').insert({ name: companyName.trim(), one_liner: oneLiner?.trim() || null }).select('id').single();
    fail(error, 'Could not add the company');
    const { data: last } = await s.from('founders').select('position').eq('lane_id', laneId).is('archived_at', null).order('position', { ascending: false }).limit(1);
    const slug = `${slugify(companyName)}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: l, error: e2 } = await s.from('founders').insert({ slug, company_id: co.id, lane_id: laneId, position: (last?.[0]?.position ?? -1) + 1 }).select('id').single();
    fail(e2, 'Could not add the company');
    if (sourceId) await board.setSources(l.id, [sourceId]);
    if (founderName?.trim()) await board.addFounder(l.id, founderName);
    const slots = [['customer', 'Could become an early customer or design partner.'], ['investor', 'Invests at this stage and the thesis fits.'], ['advisor', 'Has built in this space and can sharpen the plan.']];
    fail((await s.from('connections').insert(slots.map(([type, reason], i) => ({ founder_id: l.id, type, reason, label: 'Potential ' + type, rank: i + 1, suggested_by: 'board' })))).error, 'Could not add connection slots');
    return l.id;
  },
  async deleteListing(id) {
    const s = await client();
    const { error } = await s.from('founders').update({ archived_at: new Date().toISOString() }).eq('id', id);
    fail(error, 'Could not delete the company');
  },
  async renameLane(id, name) { const s = await client(); fail((await s.from('lanes').update({ name }).eq('id', id)).error, 'Could not rename the domain'); },
  async renameBucket(id, name) { const s = await client(); fail((await s.from('buckets').update({ name }).eq('id', id)).error, 'Could not rename the bucket'); },
  async addSource(name) {
    const s = await client();
    const { data: last } = await s.from('sources').select('position').is('archived_at', null).order('position', { ascending: false }).limit(1);
    const { error } = await s.from('sources').insert({ slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 5)}`, name: name.trim(), kind: 'other', position: (last?.[0]?.position ?? -1) + 1 });
    fail(error, 'Could not add the source');
  },
  async renameSource(id, name) { const s = await client(); fail((await s.from('sources').update({ name }).eq('id', id)).error, 'Could not rename the source'); },
  async deleteSource(id) {
    const s = await client();
    const { error } = await s.from('sources').update({ archived_at: new Date().toISOString() }).eq('id', id);
    fail(error, 'Could not delete the source');
  },
  async updateConnection(id, patch) { const s = await client(); fail((await s.from('connections').update(patch).eq('id', id)).error, 'Could not save the connection'); },
  async setConnectionPerson(conn, fullName) {
    const s = await client();
    const name = fullName.trim();
    if (!name) return board.updateConnection(conn.id, { person_id: null });
    if (conn.person?.id) return board.renamePerson(conn.person.id, name);
    const { data: p, error } = await s.from('people').insert({ full_name: name, first_name: name.split(/\s+/)[0], tags: ['network'] }).select('id').single();
    fail(error, 'Could not save the name');
    await board.updateConnection(conn.id, { person_id: p.id });
  },
  autofill: (listingId) => api('autofill', { listing_id: listingId }),
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
    const undoable = ['sources', 'buckets', 'lanes', 'people', 'companies', 'founders', 'founder_sources', 'founder_team', 'connections', 'follow_ups'];
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
      s.from('invites').select('email, full_name, role, accepted_at, created_at, inviter:invited_by(full_name)').order('created_at'),
    ]);
    fail(m.error, 'Could not load members'); fail(i.error, 'Could not load invites');
    return { members: m.data, invites: i.data };
  },
  addMember: (full_name, email, password, role) => api('admin', { action: 'add_member', full_name, email, password, role }),
  setPassword: (email, password) => api('admin', { action: 'set_password', email, password }),
  async setMember(id, patch) {
    const s = await client();
    const { error } = await s.from('members').update(patch).eq('id', id);
    fail(error, 'Could not update the member');
  },
  async agents() {
    const s = await client();
    const { data, error } = await s.from('agents').select('slug, name, kind, scopes, enabled, token_prefix, last_used_at, owner_id').order('name');
    fail(error, 'Could not load agents');
    return data;
  },
  async addAgent(name, kind, canWrite, ownerId = null) {
    const s = await client();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'agent';
    const scopes = canWrite ? ['capture:write', 'board:read', 'board:write'] : ['board:read'];
    const { error } = await s.from('agents').insert({ slug, name, kind, scopes, enabled: false, owner_id: ownerId });
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
