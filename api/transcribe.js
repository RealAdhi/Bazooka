// POST /api/transcribe  { capture_id, part: "main" | "notes" }
// The browser has already uploaded the audio to Storage and saved its path on the capture.
import { handler, isUuid } from './_lib/http.js';
import { authenticate } from './_lib/auth.js';
import { db, must, HttpError } from './_lib/supabase.js';
import { transcribeUrl } from './_lib/deepgram.js';

export const config = { maxDuration: 300 };

export default handler(async (req, body) => {
  const who = await authenticate(req);
  const { capture_id, part = 'main' } = body;
  if (!isUuid(capture_id)) throw new HttpError(400, 'capture_id is missing.');
  if (!['main', 'notes'].includes(part)) throw new HttpError(400, 'part must be "main" or "notes".');

  const sb = db(who.actor);
  const cap = must(await sb.from('captures').select('id, status, audio_path, notes_audio_path, notes_text').eq('id', capture_id).maybeSingle(), 'Loading capture');
  if (!cap) throw new HttpError(404, 'That capture does not exist.');
  const path = part === 'main' ? cap.audio_path : cap.notes_audio_path;
  if (!path) throw new HttpError(400, 'No audio has been uploaded for this capture yet.');

  const settings = must(await sb.from('settings').select('value').eq('key', 'transcription').maybeSingle(), 'Loading settings')?.value || {};
  const signed = must(await sb.storage.from('captures').createSignedUrl(path, 900), 'Signing audio URL');

  if (part === 'main') await sb.from('captures').update({ status: 'transcribing', error: null }).eq('id', capture_id);
  try {
    const t = await transcribeUrl(signed.signedUrl, settings);
    if (part === 'main') {
      must(await sb.from('captures').update({ status: 'transcribed', transcript: t.transcript, utterances: t.utterances, audio_seconds: t.seconds }).eq('id', capture_id), 'Saving transcript');
    }
    return { transcript: t.transcript, seconds: t.seconds };
  } catch (err) {
    if (part === 'main') await sb.from('captures').update({ status: 'failed', error: err.message }).eq('id', capture_id);
    throw err;
  }
});
