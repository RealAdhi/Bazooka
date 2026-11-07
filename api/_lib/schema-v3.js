// bazooka-v3: the one format agents use to save to Bazooka. This file is the single source of truth:
// the tool input schemas, the checks and the field reference in /AGENTS.md all come from here.
// No AI runs on our side. Agents do the thinking and research; Bazooka checks and stores.

export const SCHEMA_VERSION = 'bazooka-v3';
export const PEOPLE_TYPES = ['customer', 'investor', 'advisor'];
export const STAGES = ['new', 'connections_suggested', 'intros_sent', 'meeting_happened', 'feedback_captured', 'completed'];
export const PERSON_STATUSES = ['suggested', 'approved', 'intro_sent', 'meeting_happened', 'declined'];
export const MESSAGE_STATUSES = ['draft', 'approved', 'sent'];
export const MAX_PER_TYPE = 3;
export const MAX_SOURCES = 2;

const LINKEDIN = '^https?://([a-z]{2,3}\\.)?(www\\.)?linkedin\\.com/in/[^/?#\\s]+/?$';
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const s = (description, maxLength = 300, extra = {}) => ({ type: 'string', maxLength, description, ...extra });
const ns = (description, maxLength = 300, extra = {}) => ({ type: ['string', 'null'], maxLength, description, ...extra });
const obj = (properties, required = [], description) => ({ type: 'object', additionalProperties: false, properties, required, ...(description ? { description } : {}) });

const schemaField = { type: 'string', enum: [SCHEMA_VERSION], description: `Always "${SCHEMA_VERSION}".` };
const externalId = s('Your own unique id for this save (e.g. the chat message id). Sending the same id again returns the first result instead of saving twice.', 200);

export const NEEDS = obj({
  customer: ns('What kind of customers they need, specifically. Only if the conversation (or Piyush) asked for customers.', 300),
  investor: ns('What kind of investors they need, specifically. Only if asked.', 300),
  advisor: ns('What kind of advice or advisors they need, specifically. Only if asked.', 300),
}, [], 'What the company needs, per type. Only the types that were asked for. Leave a type out (or null) to keep what Bazooka already has.');

export const FOUNDER = obj({
  name: s('Full name as on LinkedIn', 120),
  role: ns('e.g. CEO, CTO, co-founder', 60),
  linkedin: ns('Their LinkedIn profile link (https://www.linkedin.com/in/...). Find it; null only if you could not.', 300, { pattern: LINKEDIN }),
}, ['name']);

export const PERSON = obj({
  type: { type: 'string', enum: PEOPLE_TYPES, description: 'customer, investor or advisor. Must be a type the company needs.' },
  name: s('Full name as on LinkedIn', 120),
  linkedin: ns('Their LinkedIn profile link. Required for people you found by research; null only for someone named in the conversation whom you could not find.', 300, { pattern: LINKEDIN }),
  title: ns('Current job title only, e.g. "Head of digital health"', 120),
  org: ns('Current organisation only, e.g. "Example Hospitals"', 120),
  why: s('One line on why this person fits this company\'s need', 300),
  degree: { type: ['integer', 'null'], minimum: 1, maximum: 3, description: 'LinkedIn connection degree to Piyush: 1, 2 or 3' },
  origin: { type: 'string', enum: ['research', 'named'], description: '"research" = you found them; "named" = someone named in the conversation. Default research.' },
}, ['type', 'name', 'why']);

export const FOLLOW_UP = obj({ task: s('What was promised or the next step, with who does it', 300), due: ns('YYYY-MM-DD', 10, { pattern: DATE }) }, ['task']);

export const COMPANY = obj({
  slug: ns('The company\'s slug from get_board. null = a new company (Bazooka refuses a duplicate name or website and tells you the existing slug).', 80),
  name: ns('Company name. Required for a new company.', 120),
  one_liner: ns('One line on what they build', 200),
  website: ns('https://...', 300),
  domain: ns('Domain (lane) slug from get_board, e.g. "ai_native"', 60),
  sources: { type: ['array', 'null'], maxItems: MAX_SOURCES, items: { type: 'string', maxLength: 60 }, description: `Source slugs from get_board where Piyush met them. Usually 1, at most ${MAX_SOURCES}. Replaces the company's sources. Use add_source first for a new source.` },
  round: ns('Funding stage and raise in a few words, e.g. "Seed, raising $1.5M"', 120),
  met_on: ns('YYYY-MM-DD, when Piyush first met them', 10, { pattern: DATE }),
}, [], 'The company. For an existing company send its slug and only the fields that changed.');

export const CONVERSATION = obj({
  date: ns('YYYY-MM-DD when the conversation happened', 10, { pattern: DATE }),
  title: ns('Short title, e.g. "Antler demo day" or "Call with Asha"', 120),
  summary: s('3 to 6 lines: what was discussed, what they need, what was promised', 3000),
  transcript: ns('The full transcript or Piyush\'s words, verbatim', 400000),
}, ['summary']);

const PEOPLE = { type: 'array', maxItems: MAX_PER_TYPE * PEOPLE_TYPES.length, items: PERSON,
  description: `People you found for this company: up to ${MAX_PER_TYPE} per type, only for the types it needs. Fewer is fine; never pad. Saving a type replaces that type's earlier suggestions nobody acted on.` };
const FOLLOW_UPS = { type: 'array', maxItems: 10, items: FOLLOW_UP, description: 'Promises and next steps' };
const QUESTIONS = { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 200 }, description: 'Questions for Piyush about important missing facts. Also ask them in the chat.' };

// ---------------------------------------------------------------------------
// Tool inputs
// ---------------------------------------------------------------------------
export const SAVE_CONVERSATION = obj({
  schema: schemaField,
  external_id: externalId,
  company: COMPANY,
  founders: { type: 'array', maxItems: 6, items: FOUNDER, description: 'The founders, with their LinkedIn links' },
  conversation: CONVERSATION,
  needs: NEEDS,
  where_we_are: ns('One line: where things stand now with this company', 300),
  people: PEOPLE,
  follow_ups: FOLLOW_UPS,
  private_note: ns('Anything Piyush called private. Stored for people only, never shown to agents or put in messages.', 2000),
  questions_for_piyush: QUESTIONS,
}, ['schema', 'company', 'conversation']);

export const SAVE_PEOPLE = obj({
  schema: schemaField,
  external_id: externalId,
  slug: s('The company\'s slug', 80),
  request: ns('Piyush\'s request in his own words, e.g. "space-tech and defence founders in my 1st degree"', 600),
  needs: NEEDS,
  people: { ...PEOPLE, minItems: 1 },
  where_we_are: ns('One line: where things stand now', 300),
}, ['schema', 'slug', 'people']);

export const UPDATE_COMPANY = obj({
  slug: s('The company\'s slug', 80),
  name: ns('Company name', 120), one_liner: ns('One line on what they build', 200), website: ns('https://...', 300),
  domain: ns('Domain (lane) slug', 60),
  sources: { type: ['array', 'null'], maxItems: MAX_SOURCES, items: { type: 'string', maxLength: 60 }, description: `Source slugs; replaces the list. At most ${MAX_SOURCES}.` },
  round: ns('e.g. "Seed, raising $1.5M"', 120), met_on: ns('YYYY-MM-DD', 10, { pattern: DATE }),
  stage: { type: 'string', enum: STAGES, description: 'Set the stage by hand (it also moves forward by itself)' },
  where_we_are: ns('One line: where things stand now', 300),
  needs: { ...NEEDS, description: 'Per type. An empty string "" clears a need.' },
  founders: { type: 'array', maxItems: 6, items: FOUNDER, description: 'Adds founders or updates them (matched by LinkedIn link, then name)' },
  follow_ups: FOLLOW_UPS,
  follow_ups_done: { type: 'array', maxItems: 20, items: { type: 'string', format: 'uuid' }, description: 'Ids of follow-ups that are done' },
  private_note: ns('Appended to the private note (people only)', 2000),
}, ['slug']);

export const UPDATE_PERSON = obj({
  id: { type: 'string', format: 'uuid', description: 'The person\'s id from get_company (people[].id)' },
  status: { type: 'string', enum: PERSON_STATUSES, description: 'suggested, approved (Piyush said yes), intro_sent, meeting_happened, declined' },
  why: ns('One line on why they fit', 300), title: ns('Job title', 120), org: ns('Organisation', 120),
  linkedin: ns('LinkedIn link', 300, { pattern: LINKEDIN }),
}, ['id']);

export const SAVE_MESSAGE = obj({
  slug: s('The company\'s slug', 80),
  message_id: { type: ['string', 'null'], format: 'uuid', description: 'To update a message you saved before (e.g. draft -> approved -> sent). Omit to save a new one.' },
  person_id: { type: ['string', 'null'], format: 'uuid', description: 'The person it introduces or is about (people[].id). Omit for messages only to the founder.' },
  guide: { type: ['string', 'null'], maxLength: 40, description: 'Which message guide you used (guides[].key), e.g. intro_customer' },
  channel: ns('e.g. WhatsApp group, LinkedIn, Email', 60),
  subject: ns('Subject line, if any', 200),
  text: ns('The full message as it will be sent. Required for a new message.', 4000),
  status: { type: 'string', enum: MESSAGE_STATUSES, description: 'draft (shown to Piyush), approved (he said yes), sent (it went out)' },
}, ['slug', 'status']);

// ---------------------------------------------------------------------------
// Check a value against one of the schemas above. Returns a list of errors ("path: problem").
// ---------------------------------------------------------------------------
function typeOk(t, v) {
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => (x === 'null' ? v === null : x === 'integer' ? Number.isInteger(v) : x === 'array' ? Array.isArray(v)
    : x === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v) : typeof v === x));
}

export function check(schema, v, path = '', errors = []) {
  const at = path || 'input';
  if (v === undefined) return errors;
  if (schema.type && !typeOk(schema.type, v)) {
    const want = [].concat(schema.type).map((t) => (t === 'null' ? 'null' : t === 'array' ? 'a list' : t === 'object' ? 'an object' : `a ${t}`)).join(' or ');
    errors.push(`${at} must be ${want}`); return errors;
  }
  if (v === null) return errors;
  if (schema.enum && !schema.enum.includes(v)) errors.push(`${at} must be one of: ${schema.enum.join(', ')}`);
  if (typeof v === 'string') {
    if (schema.maxLength && v.length > schema.maxLength) errors.push(`${at} is too long (max ${schema.maxLength} characters)`);
    if (schema.pattern && !new RegExp(schema.pattern, 'i').test(v.trim())) {
      errors.push(schema.pattern === LINKEDIN ? `${at} must be a LinkedIn profile link like https://www.linkedin.com/in/name` : `${at} must be a date as YYYY-MM-DD`);
    }
    if (schema.format === 'uuid' && !/^[0-9a-f-]{36}$/i.test(v)) errors.push(`${at} must be an id from get_company or get_board`);
  }
  if (Number.isInteger(v) && ((schema.minimum != null && v < schema.minimum) || (schema.maximum != null && v > schema.maximum))) {
    errors.push(`${at} must be between ${schema.minimum} and ${schema.maximum}`);
  }
  if (Array.isArray(v)) {
    if (schema.maxItems != null && v.length > schema.maxItems) errors.push(`${at} has ${v.length} items; at most ${schema.maxItems}`);
    if (schema.minItems != null && v.length < schema.minItems) errors.push(`${at} needs at least ${schema.minItems} item`);
    if (schema.items) v.forEach((x, i) => check(schema.items, x, `${path}[${i}]`, errors));
  } else if (typeof v === 'object') {
    for (const k of schema.required || []) if (v[k] === undefined || v[k] === null || v[k] === '') errors.push(`${path ? path + '.' : ''}${k} is required`);
    if (schema.properties) {
      for (const k of Object.keys(v)) {
        if (!schema.properties[k]) { errors.push(`${path ? path + '.' : ''}${k} is not a field here. Allowed: ${Object.keys(schema.properties).join(', ')}`); continue; }
        check(schema.properties[k], v[k], path ? `${path}.${k}` : k, errors);
      }
    }
  }
  return errors;
}

// Normalise a LinkedIn link so the same person always matches: https://www.linkedin.com/in/<id>
export function normLinkedin(u) {
  if (typeof u !== 'string' || !u.trim()) return u ?? null;
  const m = u.trim().match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}` : u.trim();
}

// Rules that span fields (beyond the shape).
export function checkPeople(people = [], needs = null, errors = [], path = 'people') {
  const per = {};
  people.forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    per[p.type] = (per[p.type] || 0) + 1;
    if ((p.origin || 'research') === 'research' && !p.linkedin) errors.push(`${path}[${i}].linkedin is required for people you found by research (origin "research")`);
  });
  for (const [t, n] of Object.entries(per)) if (n > MAX_PER_TYPE) errors.push(`${path} has ${n} ${t} entries; at most ${MAX_PER_TYPE} per type`);
  return errors;
}
