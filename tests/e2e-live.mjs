// Live end-to-end test against the real Supabase / Azure / LLM (not part of npm test).
// Run: NODE_USE_ENV_PROXY=1 node tests/e2e-live.mjs   (needs the env vars in docs/setup.md)
// Creates a temporary member, makes a synthetic Hinglish recording with Azure TTS, runs it through
// /api/transcribe and /api/ingest, checks the board, undoes it, and deletes the temporary account.
// Afterwards remove the leftover test rows with the cleanup SQL at the bottom of this file.
// End-to-end: temp member -> upload audio -> /api/transcribe -> /api/ingest -> check board -> undo -> clean up.
import fs from 'node:fs';
const REPO = new URL('..', import.meta.url).pathname;
const { createClient } = await import(REPO + '/node_modules/@supabase/supabase-js/dist/index.mjs');
const transcribe = (await import(REPO + '/api/transcribe.js')).default;
const ingest = (await import(REPO + '/api/ingest.js')).default;
const URL_ = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
const admin = createClient(URL_, SR, { auth: { persistSession: false } });
const email = 'e2e-test@bazooka.invalid', password = 'Test-' + Math.random().toString(36).slice(2) + '-pw';

function call(fn, token, body) {
  return new Promise((resolve) => {
    const res = { headersSent: false, code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.headersSent = true; resolve({ status: this.code, body: o }); } };
    fn({ method: 'POST', headers: { authorization: 'Bearer ' + token, host: 'localhost' }, body }, res);
  });
}

async function makeAudio() {
  const key = process.env.AZURE_SPEECH_KEY || process.env.speech_key, region = process.env.AZURE_SPEECH_REGION || 'eastus';
  const say = async (voice, text) => Buffer.from(await (await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, { method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-16khz-32kbitrate-mono-mp3', 'User-Agent': 'bazooka-test' },
    body: `<speak version='1.0' xml:lang='en-IN'><voice name='${voice}'>${text}</voice></speak>` })).arrayBuffer());
  return Buffer.concat([
    await say('en-IN-PrabhatNeural', 'Toh batao, aap kya build kar rahe ho?'),
    await say('en-IN-NeerjaNeural', 'Main Asha Rao hoon, Orbitly ki founder. Hum satellite data se crop insurance ke liye risk scoring bana rahe hain. Abhi seed stage pe hain, aur hume pehle teen insurance customers chahiye.'),
    await say('en-IN-PrabhatNeural', 'Great. Main aapko ek insurer se connect karta hoon, Ravi, jo Example Insurance mein head of innovation hain. Main Friday tak intro bhej dunga.'),
  ]);
}

let uid;
{ const { data } = await admin.auth.admin.listUsers(); const old = data.users.find((u) => u.email === email);
  if (old) { await admin.from('captures').delete().eq('created_by', old.id); await admin.auth.admin.deleteUser(old.id); await admin.from('invites').delete().eq('email', email); } }
try {
  await admin.from('invites').insert({ email, full_name: 'E2E test', role: 'member' });
  const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error; uid = u.user.id;
  const user = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: s, error: e2 } = await user.auth.signInWithPassword({ email, password }); if (e2) throw e2;
  const token = s.session.access_token;
  console.log('member row:', (await user.from('members').select('full_name, role').eq('id', uid).single()).data);

  const { data: cap, error: e3 } = await user.from('captures').insert({ channel: 'web', status: 'recording', created_by: uid }).select('id').single(); if (e3) throw e3;
  const path = `${cap.id}/main-${Date.now()}.mp3`;
  const up = await user.storage.from('captures').upload(path, await makeAudio(), { contentType: 'audio/mpeg' });
  if (up.error) throw up.error;
  await user.from('captures').update({ audio_path: path, audio_mime: 'audio/mpeg', status: 'uploaded' }).eq('id', cap.id);

  let t0 = Date.now();
  const tr = await call(transcribe, token, { capture_id: cap.id, part: 'main' });
  console.log(`transcribe ${tr.status} in ${Date.now() - t0}ms:`, JSON.stringify(tr.body).slice(0, 600));
  const left = await admin.storage.from('captures').list(cap.id);
  console.log('audio files left after transcription:', left.data.length);

  t0 = Date.now();
  const ing = await call(ingest, token, { capture_id: cap.id, notes_text: 'Asha is technical, strong on data. Private: she sounded worried about runway.' });
  console.log(`ingest ${ing.status} in ${Date.now() - t0}ms:`, JSON.stringify(ing.body, null, 1).slice(0, 1800));

  const f = await admin.from('founders').select('slug, status, stage, needs, private_notes, note, verify, lane:lanes(slug), company:companies(name, one_liner), person:people(full_name)').eq('slug', 'orbitly').maybeSingle();
  console.log('board row:', JSON.stringify(f.data));
  const log = await admin.from('activity_log').select('table_name, action, actor_label').eq('capture_id', cap.id);
  console.log('log entries for capture:', log.data.length, 'actors:', [...new Set(log.data.map((l) => l.actor_label))]);

  // undo as the member
  const { data: rows } = await user.from('activity_log').select('id, table_name').eq('capture_id', cap.id).is('undone_by', null)
    .in('table_name', ['sources','people','companies','founders','founder_sources','connections','follow_ups']).order('id', { ascending: false });
  for (const r of rows) { const { error } = await user.rpc('undo_activity', { p_log_id: r.id }); if (error) console.log('undo error', r.table_name, error.message); }
  const after = await admin.from('founders').select('slug, archived_at').eq('slug', 'orbitly').maybeSingle();
  console.log('after undo:', JSON.stringify(after.data));
} finally {
  if (uid) {
    await admin.from('captures').delete().eq('created_by', uid);
    const d = await admin.auth.admin.deleteUser(uid); if (d.error) console.log('delete user error', d.error.message);
  }
  await admin.from('invites').delete().eq('email', email);
}

/* Cleanup SQL (run with supabase/tests/remote-sql.sh -f <file>):
begin;
create temp table t_rows as select table_name, row_id from activity_log where actor_label = 'E2E test';
delete from connections where founder_id in (select id from founders where slug='orbitly');
delete from follow_ups where founder_id in (select id from founders where slug='orbitly');
delete from founder_sources where founder_id in (select id from founders where slug='orbitly');
delete from founders where slug='orbitly';
delete from people where id::text in (select row_id from t_rows where table_name='people');
delete from companies where id::text in (select row_id from t_rows where table_name='companies');
delete from sources where id::text in (select row_id from t_rows where table_name='sources');
alter table activity_log disable trigger user;
delete from activity_log where actor_label = 'E2E test' or row_id in (select row_id from t_rows);
alter table activity_log enable trigger user;
commit;
*/
