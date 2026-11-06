// POST /api/admin  { action, ... }   — admin only. No emails are ever sent.
//   add_member   { full_name, email, password, role } -> creates the login directly and adds them to the team
//   set_password { email, password }                  -> sets someone's password
//   mint_token   { agent_slug }                       -> returns a new bzk_ token ONCE; only its hash is stored
//   revoke_token { agent_slug }
// Everything else the admin page does (roles, removing access, settings, log) goes through the
// database directly and is protected by RLS.
import { randomBytes } from 'node:crypto';
import { handler } from './_lib/http.js';
import { authenticate, requireAdmin, sha256 } from './_lib/auth.js';
import { db, must, HttpError } from './_lib/supabase.js';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function findUser(sb, email) {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new HttpError(502, error.message);
    const u = data.users.find((x) => (x.email || '').toLowerCase() === email);
    if (u || data.users.length < 200) return u || null;
  }
  return null;
}

export default handler(async (req, body) => {
  const who = await authenticate(req);
  requireAdmin(who);
  const sb = db(who.actor);

  switch (body.action) {
    case 'add_member': {
      const email = String(body.email || '').trim().toLowerCase();
      const full_name = String(body.full_name || '').trim();
      const password = String(body.password || '');
      const role = body.role === 'admin' ? 'admin' : 'member';
      if (!full_name) throw new HttpError(400, 'Enter their name.');
      if (!EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address.');
      if (password.length < 8) throw new HttpError(400, 'The password needs at least 8 characters.');
      // The invite row is the record of who added them; a trigger turns the login into a member.
      must(await sb.from('invites').upsert({ email, full_name, role, invited_by: who.member.id }, { onConflict: 'email' }), 'Saving the person');
      const existing = await findUser(sb, email);
      if (existing) {
        const { error } = await sb.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
        if (error) throw new HttpError(502, error.message);
        must(await sb.from('members').upsert({ id: existing.id, full_name, email, role, active: true }), 'Adding to the team');
      } else {
        const { error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } });
        if (error) throw new HttpError(502, `Could not create the login: ${error.message}`);
      }
      return { ok: true };
    }
    case 'set_password': {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (password.length < 8) throw new HttpError(400, 'The password needs at least 8 characters.');
      const u = await findUser(sb, email);
      if (!u) throw new HttpError(404, 'No login with that email.');
      const { error } = await sb.auth.admin.updateUserById(u.id, { password });
      if (error) throw new HttpError(502, error.message);
      return { ok: true };
    }
    case 'mint_token': {
      const agent = must(await sb.from('agents').select('id, slug').eq('slug', String(body.agent_slug || '')).maybeSingle(), 'Loading agent');
      if (!agent) throw new HttpError(404, 'Unknown agent.');
      const token = 'bzk_' + randomBytes(32).toString('base64url');
      must(await sb.from('agents').update({ token_hash: sha256(token), token_prefix: token.slice(0, 10), enabled: true }).eq('id', agent.id), 'Saving token');
      return { ok: true, token, note: 'Copy this now. It will not be shown again.' };
    }
    case 'revoke_token': {
      const res = must(await sb.from('agents').update({ token_hash: null, token_prefix: null, enabled: false })
        .eq('slug', String(body.agent_slug || '')).select('slug'), 'Revoking token');
      if (!res.length) throw new HttpError(404, 'Unknown agent.');
      return { ok: true };
    }
    default:
      throw new HttpError(400, 'Unknown action.');
  }
});
