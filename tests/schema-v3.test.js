// Unit tests for the bazooka-v3 format checks. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_CONVERSATION, SAVE_PEOPLE, UPDATE_COMPANY, SAVE_MESSAGE, check, checkPeople, normLinkedin } from '../api/_lib/schema-v3.js';

const good = {
  schema: 'bazooka-v3', external_id: 'm1',
  company: { slug: null, name: 'Orbit', one_liner: 'Risk scores', domain: 'space', sources: ['antler'], round: 'Seed', met_on: '2026-11-06' },
  founders: [{ name: 'Asha Rao', role: 'CEO', linkedin: 'https://www.linkedin.com/in/asha-rao/' }],
  conversation: { date: '2026-11-06', title: 'Demo day', summary: 'Met Asha.', transcript: 'text' },
  needs: { customer: 'first three insurers' },
  people: [{ type: 'customer', name: 'Ravi K', linkedin: 'https://in.linkedin.com/in/ravi-k', why: 'Buys risk data', degree: 1 }],
  follow_ups: [{ task: 'Intro Ravi', due: '2026-11-09' }],
  questions_for_piyush: [],
};

test('a good save_conversation passes', () => {
  assert.deepEqual(check(SAVE_CONVERSATION, good), []);
  assert.deepEqual(checkPeople(good.people), []);
});

test('wrong schema version, missing summary, unknown field', () => {
  const e = check(SAVE_CONVERSATION, { ...good, schema: 'v2', conversation: { title: 'x' }, extra: 1 });
  assert.ok(e.some((x) => x.startsWith('schema must be one of: bazooka-v3')));
  assert.ok(e.includes('conversation.summary is required'));
  assert.ok(e.some((x) => x.startsWith('extra is not a field here')));
});

test('LinkedIn links and dates are checked', () => {
  const e = check(SAVE_CONVERSATION, { ...good, founders: [{ name: 'A', linkedin: 'https://example.com/a' }], company: { ...good.company, met_on: '6 Nov' } });
  assert.ok(e.some((x) => x.startsWith('founders[0].linkedin must be a LinkedIn profile link')));
  assert.ok(e.includes('company.met_on must be a date as YYYY-MM-DD'));
});

test('at most 2 sources, at most 3 per type, research people need a link', () => {
  assert.ok(check(SAVE_CONVERSATION, { ...good, company: { ...good.company, sources: ['a', 'b', 'c'] } }).some((x) => x.includes('at most 2')));
  const four = Array.from({ length: 4 }, (_, i) => ({ type: 'investor', name: 'I' + i, linkedin: `https://www.linkedin.com/in/i${i}`, why: 'x' }));
  assert.ok(checkPeople(four).some((x) => x.includes('4 investor entries; at most 3')));
  assert.ok(checkPeople([{ type: 'advisor', name: 'X', why: 'y' }]).some((x) => x.includes('linkedin is required')));
  assert.deepEqual(checkPeople([{ type: 'advisor', name: 'X', why: 'y', origin: 'named', linkedin: null }]), []);
});

test('save_people needs a slug and people', () => {
  const e = check(SAVE_PEOPLE, { schema: 'bazooka-v3', people: [] });
  assert.ok(e.includes('slug is required'));
  assert.ok(e.some((x) => x.includes('at least 1')));
});

test('update_company and save_message shapes', () => {
  assert.deepEqual(check(UPDATE_COMPANY, { slug: 'x', stage: 'intros_sent', needs: { investor: '' } }), []);
  assert.ok(check(UPDATE_COMPANY, { slug: 'x', stage: 'done' }).some((x) => x.startsWith('stage must be one of')));
  assert.ok(check(SAVE_MESSAGE, { slug: 'x', status: 'queued' }).some((x) => x.startsWith('status must be one of')));
  assert.ok(check(SAVE_MESSAGE, { slug: 'x', status: 'sent', person_id: 'abc' }).some((x) => x.includes('must be an id')));
});

test('LinkedIn links are normalised so the same person matches', () => {
  assert.equal(normLinkedin('https://in.linkedin.com/in/Ravi-K/?utm=1'), 'https://www.linkedin.com/in/ravi-k');
  assert.equal(normLinkedin('linkedin.com/in/asha-rao/'), 'https://www.linkedin.com/in/asha-rao');
});
