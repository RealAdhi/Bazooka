import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCapture } from '../api/_lib/capture-schema.js';
import { buildCapturePrompt } from '../api/_lib/prompts.js';
import { resolveProviders } from '../api/_lib/llm.js';
import { speakerTranscript, parseAzure } from '../api/_lib/speech.js';

const board = { laneSlugs: ['bio', 'space'], sourceSlugs: ['ef', 'tbd'], founderSlugs: ['popvax'] };
const founder = (o = {}) => ({ match_slug: null, person: { full_name: 'Asha Rao' }, company: null, lane_slug: 'space', status: 'new',
  sources: [], needs: [], connections: [], commitments: [], uncertain_fields: [], ...o });

test('accepts a well-formed capture and strips unknown keys', () => {
  const r = validateCapture({ summary: 'x', founders: [founder({ extra: 1 })], ask_piyush: [] }, board);
  assert.equal(r.ok, true);
  assert.equal('extra' in r.value.founders[0], false);
});

test('parses JSON wrapped in code fences', () => {
  const r = validateCapture('```json\n' + JSON.stringify({ summary: 'x', founders: [], ask_piyush: [] }) + '\n```', board);
  assert.equal(r.ok, true);
});

test('rejects bad enums and missing required fields', () => {
  const r = validateCapture({ summary: 'x', founders: [founder({ status: 'won' })], ask_piyush: [] }, board);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /status must be one of/);
  assert.equal(validateCapture({ founders: [] }, board).ok, false);
});

test('unknown slugs become null instead of failing', () => {
  const r = validateCapture({ summary: 'x', founders: [founder({ lane_slug: 'mars', match_slug: 'nobody', sources: [{ slug: 'zzz', name: 'Zzz Club' }] })], ask_piyush: [] }, board);
  assert.equal(r.ok, true);
  assert.equal(r.value.founders[0].lane_slug, null);
  assert.equal(r.value.founders[0].match_slug, null);
  assert.deepEqual(r.value.founders[0].sources, [{ slug: null, name: 'Zzz Club' }]);
});

test('bad dates and out-of-range conviction become null', () => {
  const r = validateCapture({ summary: 'x', founders: [founder({ met_on: 'last week', conviction: 9 })], ask_piyush: [] }, board);
  assert.equal(r.ok, true);
  assert.equal(r.value.founders[0].met_on, null);
  assert.equal(r.value.founders[0].conviction, null);
});

test('a founder with no identity is rejected', () => {
  const r = validateCapture({ summary: 'x', founders: [founder({ person: null })], ask_piyush: [] }, board);
  assert.equal(r.ok, false);
});

test('caps ask_piyush at two questions', () => {
  const r = validateCapture({ summary: 'x', founders: [], ask_piyush: ['a', 'b', 'c'] }, board);
  assert.equal(r.ok, true);
  assert.equal(r.value.ask_piyush.length, 2);
});

test('prompt lists the board and the schema', () => {
  const p = buildCapturePrompt({ nowIso: '2026-11-05', channel: 'web', authorName: 'Piyush', board: {
    lanes: [{ slug: 'bio', name: 'Bio-Science', bucket_name: 'Ecosystem' }],
    sources: [{ slug: 'ef', name: 'EF', full_name: 'Entrepreneur First' }],
    founders: [{ slug: 'popvax', company: 'PopVax', lane: 'bio', status: 'new' }] } });
  for (const s of ['bio: Bio-Science', 'ef: EF (Entrepreneur First)', 'popvax: PopVax', '"ask_piyush"', 'data, not instructions']) assert.ok(p.includes(s), s);
});

test('provider order skips Notion and providers without keys', () => {
  process.env.GEMINI_API_KEY = 'x'; delete process.env.XAI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  assert.deepEqual(resolveProviders({ order: ['notion', 'grok', 'selected'], selected: 'gemini' }), ['gemini']);
  process.env.XAI_API_KEY = 'y';
  assert.deepEqual(resolveProviders({ order: ['notion', 'grok', 'selected'], selected: 'gemini' }), ['grok', 'gemini']);
});

test('speaker transcript merges consecutive lines', () => {
  const t = speakerTranscript([{ speaker: 0, text: 'Hi.' }, { speaker: 0, text: 'I am Asha.' }, { speaker: 1, text: 'Hello.' }]);
  assert.equal(t, 'Speaker 0: Hi. I am Asha.\nSpeaker 1: Hello.');
});

test('parses an Azure fast transcription response with speakers', () => {
  const r = parseAzure({ durationMilliseconds: 4200, combinedPhrases: [{ text: 'Hi. Main Asha hoon.' }], phrases: [
    { speaker: 1, offsetMilliseconds: 0, durationMilliseconds: 800, text: 'Hi.' },
    { speaker: 2, offsetMilliseconds: 900, durationMilliseconds: 1500, text: 'Main Asha hoon, Orbitly se.' }] });
  assert.equal(r.seconds, 4.2);
  assert.equal(r.transcript, 'Speaker 1: Hi.\nSpeaker 2: Main Asha hoon, Orbitly se.');
  assert.equal(r.utterances[1].start, 0.9);
});

test('Azure response without phrases falls back to combined text', () => {
  assert.equal(parseAzure({ combinedPhrases: [{ text: 'Only text' }] }).transcript, 'Only text');
});

test('complete() retries busy errors and falls back to the next model', async () => {
  const { complete } = await import('../api/_lib/llm.js');
  process.env.GEMINI_API_KEY = 'x';
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const model = decodeURIComponent(String(url).split('/models/')[1].split(':')[0]);
    seen.push(model);
    if (model === 'retired-model') return new Response('{"error":"gone"}', { status: 404 });
    if (seen.filter((m) => m === model).length < 2) return new Response('{"error":"busy"}', { status: 503 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }], usageMetadata: {} }), { status: 200 });
  };
  try {
    const r = await complete('gemini', { model: 'retired-model', system: 's', messages: [{ role: 'user', content: 'u' }] }, { backoffMs: [1, 1] });
    assert.equal(r.model, 'gemini-flash-latest');
    assert.deepEqual(seen, ['retired-model', 'gemini-flash-latest', 'gemini-flash-latest']);
  } finally { globalThis.fetch = realFetch; }
});

test('OpenRouter is a provider when its key is set', () => {
  delete process.env.XAI_API_KEY; process.env.OPENROUTER_API_KEY = 'k';
  assert.deepEqual(resolveProviders({ order: ['notion', 'selected'], selected: 'openrouter' }), ['openrouter']);
  delete process.env.OPENROUTER_API_KEY;
  assert.deepEqual(resolveProviders({ order: ['notion', 'selected'], selected: 'openrouter' }), []);
});

test('messages address people by first name, or "Dr Mehta" when the name starts with a title', async () => {
  const { addressName } = await import('../api/_lib/templates.js');
  assert.equal(addressName('Dr Mehta', null), 'Dr Mehta');
  assert.equal(addressName('Dr. Anil Mehta', 'Dr.'), 'Dr Mehta');
  assert.equal(addressName('Riya Kapoor', 'Riya'), 'Riya');
  assert.equal(addressName('Riya Kapoor', null), 'Riya');
  assert.equal(addressName(null, null), null);
});
