// Live test of the agent tools over MCP against the real Supabase (not part of npm test).
// Run: NODE_USE_ENV_PROXY=1 node tests/agent-live.mjs
// Creates a temporary agent + token, exercises every tool through /api/mcp, then removes the agent
// and every row it changed. The log keeps its entries, labelled "Live test agent".
import { createHash, randomBytes } from 'node:crypto';
const REPO = new URL('..', import.meta.url).pathname;
const { createClient } = await import(REPO + 'node_modules/@supabase/supabase-js/dist/index.mjs');
const mcp = (await import(REPO + 'api/mcp.js')).default;
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const token = 'bzk_' + randomBytes(32).toString('base64url');
const SLUG = 'test-agent-live';

const post = (body, auth = token) => new Promise((resolve) => {
  const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; },
    json(o) { resolve({ status: this.code, body: o }); }, end() { resolve({ status: this.code, body: null }); } };
  mcp({ method: 'POST', headers: { authorization: 'Bearer ' + auth }, body }, res);
});
let n = 0;
const call = async (name, args) => {
  const r = await post({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } });
  const out = r.body.result;
  console.log(`${out.isError ? 'ERR' : 'ok '} ${name}:`, out.content[0].text.slice(0, 260).replace(/\s+/g, ' '));
  return out.isError ? null : out.structuredContent;
};

await admin.from('agents').delete().eq('slug', SLUG);
await admin.from('agents').insert({ slug: SLUG, name: 'Live test agent', kind: 'other', token_hash: createHash('sha256').update(token).digest('hex'),
  token_prefix: token.slice(0, 10), scopes: ['capture:write', 'board:read', 'board:write'], enabled: true });
try {
  console.log('bad token ->', (await post({ jsonrpc: '2.0', id: 0, method: 'tools/list' }, 'bzk_nope')).status);
  const init = await post({ jsonrpc: '2.0', id: ++n, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  console.log('initialize ->', init.body.result.serverInfo.name, init.body.result.protocolVersion);
  console.log('initialized notification ->', (await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status);
  const list = await post({ jsonrpc: '2.0', id: ++n, method: 'tools/list' });
  console.log('tools/list ->', list.body.result.tools.map((t) => t.name).join(', '));

  const ov = await call('get_overview', {});
  console.log('   lanes:', ov.lanes.map((l) => l.slug).join(','), '| founders:', ov.progress.founders);
  await call('list_founders', { lane: 'bio' });
  await call('list_founders', { query: 'prava' });
  await call('get_founder', { slug: 'popvax' });
  await call('update_founder', { slug: 'popvax', stage: 'seed', note: 'Live agent test note', checked: [] });
  const added = await call('add_connection', { slug: 'popvax', full_name: 'Test Connection Person', type: 'customer', reason: 'Test only', org: 'Example Hospital', title: 'CMO' });
  if (added) await call('update_connection', { connection_id: added.connection_id, status: 'intro_sent' });
  await call('get_messages', { slug: 'popvax' });
  await call('update_founder', { slug: 'popvax', status: 'warp-speed' });          // expected error
  await call('update_founder', { slug: 'nobody-here', stage: 'x' });               // expected error
  await call('list_follow_ups', {});
  await call('recent_activity', { limit: 5 });
  const cap = await call('submit_capture', { notes: 'Met Neha Test of TestCo at the Antler demo day. Building AI for test automation. Needs first enterprise customers. Promised to intro her to a QA head by Monday.', external_id: 'live-test-1' });
  const again = await call('submit_capture', { notes: 'same', external_id: 'live-test-1' });
  console.log('   duplicate detected:', again?.duplicate === true);
  void cap;
} finally {
  // Remove everything the test agent did.
  const { data: ag } = await admin.from('agents').select('id').eq('slug', SLUG).single();
  const { data: logs } = await admin.from('activity_log').select('id, table_name, row_id, action, before').eq('actor_id', SLUG).order('id', { ascending: false });
  const caps = (await admin.from('captures').select('id').eq('agent_id', ag.id)).data.map((c) => c.id);
  const { data: capLogs } = caps.length ? await admin.from('activity_log').select('id, table_name, row_id, action, before').in('capture_id', caps).order('id', { ascending: false }) : { data: [] };
  console.log('cleanup:', logs.length + capLogs.length, 'logged changes');
  const all = [...logs, ...capLogs].sort((a, b) => b.id - a.id);
  for (const l of all) {
    if (l.action === 'insert') {
      if (l.table_name === 'founder_sources') { const [f, s] = l.row_id.split(':'); await admin.from('founder_sources').delete().eq('founder_id', f).eq('source_id', s); }
      else await admin.from(l.table_name).delete().eq('id', l.row_id);
    } else if (l.action === 'update') {
      const { id, created_at, updated_at, ...rest } = l.before; void created_at; void updated_at;
      await admin.from(l.table_name).update(rest).eq('id', id);
    }
  }
  await admin.from('llm_usage').delete().in('capture_id', caps.length ? caps : ['00000000-0000-0000-0000-000000000000']);
  await admin.from('captures').delete().eq('agent_id', ag.id);
  await admin.from('agents').delete().eq('slug', SLUG);
}
