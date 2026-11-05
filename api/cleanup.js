// GET /api/cleanup — daily (vercel.json cron). Deletes audio left in Storage for more than
// 24 hours (recordings that were never transcribed). Transcripts are kept.
// Vercel cron calls carry "Authorization: Bearer $CRON_SECRET" when CRON_SECRET is set.
import { handler } from './_lib/http.js';
import { db, HttpError } from './_lib/supabase.js';

export default handler(async (req) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) throw new HttpError(401, 'Not allowed.');
  const sb = db('agent:system-cleanup');
  const cutoff = Date.now() - 24 * 3600 * 1000;
  let removed = 0;
  const { data: folders, error } = await sb.storage.from('captures').list('', { limit: 1000 });
  if (error) throw new HttpError(500, error.message);
  for (const f of folders || []) {
    const { data: files } = await sb.storage.from('captures').list(f.name, { limit: 100 });
    const old = (files || []).filter((x) => x.created_at && Date.parse(x.created_at) < cutoff).map((x) => `${f.name}/${x.name}`);
    if (old.length) {
      await sb.storage.from('captures').remove(old);
      removed += old.length;
      await sb.from('captures').update({ audio_path: null, notes_audio_path: null, error: 'Audio was deleted after 24 hours without being transcribed.' })
        .eq('id', f.name).neq('status', 'processed');
    }
  }
  return { removed };
}, { methods: ['GET'] });
