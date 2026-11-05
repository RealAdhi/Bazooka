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
