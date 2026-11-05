// Deepgram speech-to-text for a file Deepgram fetches itself (signed Supabase URL),
// so large recordings never pass through Vercel.
import { HttpError } from './supabase.js';

export async function transcribeUrl(url, { model = 'nova-3', language = 'multi', diarize = true } = {}) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new HttpError(503, 'Transcription is not set up yet. Ask the admin to add the Deepgram key.');
  const q = new URLSearchParams({
    model, language, smart_format: 'true', punctuate: 'true', paragraphs: 'true',
    utterances: 'true', diarize: String(diarize),
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
    method: 'POST',
    headers: { authorization: `Token ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(280000),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(502, `Deepgram could not transcribe this recording (${res.status}). ${text.slice(0, 200)}`);
  const data = JSON.parse(text);

  const utterances = (data.results?.utterances || []).map((u) => ({
    speaker: u.speaker, start: u.start, end: u.end, text: u.transcript,
  }));
  return {
    transcript: speakerTranscript(utterances) || data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '',
    utterances,
    seconds: data.metadata?.duration ?? null,
  };
}

// "Speaker 0: ...", merging consecutive lines from the same speaker.
export function speakerTranscript(utterances) {
  const speakers = new Set(utterances.map((u) => u.speaker));
  if (!utterances.length) return '';
  if (speakers.size <= 1) return utterances.map((u) => u.text).join(' ');
  const lines = [];
  for (const u of utterances) {
    const last = lines[lines.length - 1];
    if (last && last.speaker === u.speaker) last.text += ' ' + u.text;
    else lines.push({ speaker: u.speaker, text: u.text });
  }
  return lines.map((l) => `Speaker ${l.speaker}: ${l.text}`).join('\n');
}
