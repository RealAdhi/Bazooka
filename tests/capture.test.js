import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCapture } from '../api/_lib/capture-schema.js';
import { buildCapturePrompt } from '../api/_lib/prompts.js';
import { resolveProviders } from '../api/_lib/llm.js';
import { speakerTranscript } from '../api/_lib/deepgram.js';

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
