// Bazooka's own AI is off by default (settings.ai_mode = "agent"): connected agents do all the thinking
// and save structured results with the bazooka-v3 tools. The old AI endpoints stay in the code, unused,
// and answer 410 while the switch is off. Setting ai_mode to "server" turns them back on.
import { db, HttpError } from './supabase.js';

export async function requireServerAi() {
  const { data } = await db().from('settings').select('value').eq('key', 'ai_mode').maybeSingle();
  if ((data?.value ?? 'agent') !== 'server') {
    throw new HttpError(410, 'Bazooka\'s own AI is switched off: agents do the thinking and save with save_conversation. Read /AGENTS.md.');
  }
}
