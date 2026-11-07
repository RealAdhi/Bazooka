// Who is calling? Either a logged-in member (Supabase access token) or an agent (bzk_ token).
import { createHash } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { db, HttpError } from './supabase.js';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// The site's own address, for links in tool results (e.g. a company's card).
export function originOf(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return host ? `${host.startsWith('localhost') ? 'http' : 'https'}://${host}` : '';
}

export async function authenticate(req, opts = {}) {
  const who = await identify(req, opts);
  who.origin = originOf(req);
  return who;
}

async function identify(req, { allowAgents = false, scope } = {}) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Sign in first.');

  if (token.startsWith('bzk_')) {
    if (!allowAgents) throw new HttpError(403, 'Agents cannot use this endpoint.');
    const { data: agent } = await db().from('agents').select('id, slug, name, kind, scopes, enabled')
      .eq('token_hash', sha256(token)).maybeSingle();
    if (!agent || !agent.enabled) throw new HttpError(401, 'This agent token is not valid or is switched off.');
    if (scope && !agent.scopes.includes(scope)) throw new HttpError(403, `This agent token does not have ${scope}.`);
    // Don't make the agent wait for this timestamp.
    waitUntil(db().from('agents').update({ last_used_at: new Date().toISOString() }).eq('id', agent.id).then(() => {}, () => {}));
    return { kind: 'agent', agent, actor: `agent:${agent.slug}` };
  }

  const { data, error } = await db().auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Your session has expired. Sign in again.');
  const { data: member } = await db().from('members').select('id, full_name, role, active').eq('id', data.user.id).maybeSingle();
  if (!member || !member.active) throw new HttpError(403, 'This account is not on the Bazooka team.');
  return { kind: 'member', member, actor: `member:${member.id}` };
}

export function requireAdmin(who) {
  if (who.kind !== 'member' || who.member.role !== 'admin') throw new HttpError(403, 'Only the admin can do this.');
}
