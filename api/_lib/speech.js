// Speech-to-text. Provider comes from settings.transcription.provider: 'azure' (default) or 'deepgram'.
// Audio is fetched from a short-lived signed Supabase Storage URL, so it never passes through the browser twice.
import { HttpError } from './supabase.js';

export async function transcribe(url, settings = {}) {
  const provider = settings.provider || 'azure';
  if (provider === 'azure') return transcribeAzure(url, settings);
  if (provider === 'deepgram') return transcribeDeepgram(url, settings);
  throw new HttpError(500, `Unknown transcription provider ${provider}`);
}

// Azure AI Speech, fast transcription REST API (synchronous; files up to 2 hours / 300 MB).
// en-IN handles Indian English and Hinglish code-switching and returns Roman script.
export async function transcribeAzure(url, { locale = 'en-IN', diarize = true, max_speakers = 6 } = {}) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) throw new HttpError(503, 'Transcription is not set up yet. Ask the admin to add the Azure Speech key and region.');

  const audioRes = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!audioRes.ok) throw new HttpError(502, `Could not read the recording from storage (${audioRes.status}).`);
  const audio = await audioRes.blob();

  const definition = { locales: [locale], profanityFilterMode: 'None' };
  if (diarize) definition.diarization = { enabled: true, maxSpeakers: Math.max(2, Math.min(36, max_speakers)) };
  const form = new FormData();
  form.append('audio', audio, 'recording');
  form.append('definition', JSON.stringify(definition));

  const res = await fetch(`https://${region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key },
    body: form,
    signal: AbortSignal.timeout(280000),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(502, `Azure could not transcribe this recording (${res.status}). ${text.slice(0, 200)}`);
  return parseAzure(JSON.parse(text));
}

export function parseAzure(data) {
  const utterances = (data.phrases || []).map((p) => ({
    speaker: p.speaker ?? 0,
    start: (p.offsetMilliseconds ?? 0) / 1000,
    end: ((p.offsetMilliseconds ?? 0) + (p.durationMilliseconds ?? 0)) / 1000,
    text: p.text || '',
  })).filter((u) => u.text);
  return {
    transcript: speakerTranscript(utterances) || (data.combinedPhrases || []).map((c) => c.text).join('\n'),
    utterances,
    seconds: data.durationMilliseconds != null ? data.durationMilliseconds / 1000 : null,
  };
}

// Deepgram pre-recorded API; Deepgram fetches the URL itself.
export async function transcribeDeepgram(url, { model = 'nova-3', language = 'multi', diarize = true } = {}) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new HttpError(503, 'Deepgram is not set up. Ask the admin to add the Deepgram key, or switch transcription to Azure.');
  const q = new URLSearchParams({ model, language, smart_format: 'true', punctuate: 'true', paragraphs: 'true', utterances: 'true', diarize: String(diarize) });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
    method: 'POST',
    headers: { authorization: `Token ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(280000),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(502, `Deepgram could not transcribe this recording (${res.status}). ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  const utterances = (data.results?.utterances || []).map((u) => ({ speaker: u.speaker, start: u.start, end: u.end, text: u.transcript }));
  return {
    transcript: speakerTranscript(utterances) || data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '',
    utterances,
    seconds: data.metadata?.duration ?? null,
  };
}

// "Speaker 1: ...", merging consecutive lines from the same speaker. One speaker = plain text.
export function speakerTranscript(utterances) {
  if (!utterances.length) return '';
  const speakers = new Set(utterances.map((u) => u.speaker));
  if (speakers.size <= 1) return utterances.map((u) => u.text).join(' ');
  const lines = [];
  for (const u of utterances) {
    const last = lines[lines.length - 1];
    if (last && last.speaker === u.speaker) last.text += ' ' + u.text;
    else lines.push({ speaker: u.speaker, text: u.text });
  }
  return lines.map((l) => `Speaker ${l.speaker}: ${l.text}`).join('\n');
}
