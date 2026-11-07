// GET /AGENTS.md (and "/" when an agent asks for markdown): the agent guide, generated from the code.
// Public, no token needed. It describes the API; it holds no board data.
import { originOf } from './_lib/auth.js';
import { db } from './_lib/supabase.js';
import { agentsMarkdown } from './_lib/agents-md.js';

export default async function agentsMd(req, res) {
  let prompts = {};
  try { prompts = (await db().from('settings').select('value').eq('key', 'search_prompts').maybeSingle()).data?.value || {}; } catch {}
  res.setHeader('content-type', 'text/markdown; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
  res.setHeader('x-robots-tag', 'noindex');
  res.setHeader('vary', 'accept');
  res.status(200).send(agentsMarkdown(originOf(req), prompts));
}
