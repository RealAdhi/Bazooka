// POST /api/admin  { action, ... }   — admin only.
//   invite        { email, full_name, role }  -> adds to the invite list and Supabase emails them a sign-in link
//   resend_invite { email }
//   mint_token    { agent_slug }              -> returns a new bzk_ token ONCE; only its hash is stored
//   revoke_token  { agent_slug }
// Everything else the admin panel does (roles, deactivating, settings, log export) goes through
// the database directly and is protected by RLS.
import { randomBytes } from 'node:crypto';
import { handler } from './_lib/http.js';
import { authenticate, requireAdmin, sha256 } from './_lib/auth.js';
import { db, must, HttpError } from './_lib/supabase.js';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function siteUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return process.env.SITE_URL || `${proto}://${host}`;
}

async function sendInvite(sb, req, email) {
  const { error } = await sb.auth.admin.inviteUserByEmail(email, { redirectTo: `${siteUrl(req)}/login.html?next=set-password` });
  if (!error) return { emailed: true };
  // Already has an account: send a sign-in link instead.
  if (/already|registered|exists/i.test(error.message)) {
    const { error: e2 } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${siteUrl(req)}/login.html` } });
    if (e2) throw new HttpError(502, `Could not email ${email}: ${e2.message}`);
    return { emailed: true, existing: true };
  }
  throw new HttpError(502, `Could not email ${email}: ${error.message}`);
}

export default handler(async (req, body) => {
  const who = await authenticate(req);
  requireAdmin(who);
  const sb = db(who.actor);

  switch (body.action) {
    case 'invite': {
      const email = String(body.email || '').trim().toLowerCase();
      const full_name = String(body.full_name || '').trim();
      const role = body.role === 'admin' ? 'admin' : 'member';
      if (!EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address.');
      if (!full_name) throw new HttpError(400, 'Enter their name.');
      must(await sb.from('invites').upsert({ email, full_name, role, invited_by: who.member.id }, { onConflict: 'email' }), 'Saving invite');
      return { ok: true, ...(await sendInvite(sb, req, email)) };
    }
    case 'resend_invite': {
      const email = String(body.email || '').trim().toLowerCase();
      const inv = must(await sb.from('invites').select('email').eq('email', email).maybeSingle(), 'Loading invite');
      if (!inv) throw new HttpError(404, 'That email is not on the invite list.');
      return { ok: true, ...(await sendInvite(sb, req, email)) };
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
