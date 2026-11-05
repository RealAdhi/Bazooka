// The capture contract: the exact JSON every LLM must return, and the validator that
// enforces it before anything touches the database (supabase/migrations/*_apply_capture.sql).
// One source of truth: the JSON Schema below is also sent to the LLM.

export const FOUNDER_STATUSES = ['new', 'connections_suggested', 'intros_sent', 'meeting_happened', 'feedback_captured'];
export const CONNECTION_TYPES = ['customer', 'investor', 'advisor', 'other'];
const UNCERTAIN_FIELDS = ['first_name', 'full_name', 'company', 'one_liner', 'source_ids', 'lane', 'stage', 'met_on'];

const str = (max) => ({ type: ['string', 'null'], maxLength: max });

export const CAPTURE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'founders', 'ask_piyush'],
  properties: {
    summary: { type: 'string', maxLength: 400, description: 'One or two plain sentences: what this capture was about.' },
    founders: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['match_slug', 'person', 'company', 'lane_slug', 'status', 'sources', 'needs', 'connections',
                   'commitments', 'uncertain_fields'],
        properties: {
          match_slug: { ...str(80), description: 'slug of an existing founder from the board list, or null if new' },
          person: {
            type: ['object', 'null'], additionalProperties: false,
            properties: { full_name: str(120), first_name: str(60), linkedin_url: str(300), email: str(200), phone: str(30) }
          },
          company: {
            type: ['object', 'null'], additionalProperties: false,
            properties: { name: str(120), one_liner: str(200), website: str(300) }
          },
          lane_slug: { ...str(60), description: 'one of the lane slugs given, or null if unclear' },
          bucket_reason: str(300),
          status: { type: ['string', 'null'], enum: [...FOUNDER_STATUSES, null] },
          stage: str(60),
          raise_clause: str(120),
          needs: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 200 } },
          founder_highlight: str(300),
          recent_signal: str(300),
          strategy_topic: str(200),
          advice_topic: str(200),
          source_event: str(200),
          met_on: { ...str(10), description: 'YYYY-MM-DD' },
          conviction: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
          customer_tick: { type: ['boolean', 'null'] },
          sources: {
            type: 'array', maxItems: 4,
            items: { type: 'object', additionalProperties: false, required: ['slug', 'name'],
                     properties: { slug: str(60), name: str(120) } }
          },
          connections: {
            type: 'array', maxItems: 6,
            items: {
              type: 'object', additionalProperties: false, required: ['full_name', 'type'],
              properties: {
                full_name: str(120), first_name: str(60), title: str(120), org: str(120),
                type: { type: 'string', enum: CONNECTION_TYPES },
                reason: str(300), relevance: str(300), thesis: str(300)
              }
            }
          },
          commitments: {
            type: 'array', maxItems: 8,
            items: { type: 'object', additionalProperties: false, required: ['task', 'due_on'],
                     properties: { task: { type: 'string', maxLength: 300 }, due_on: str(10) } }
          },
          uncertain_fields: { type: 'array', maxItems: 8, items: { type: 'string', enum: UNCERTAIN_FIELDS } },
          note: str(600),
          private_notes: str(1000)
        }
      }
    },
    ask_piyush: { type: 'array', maxItems: 2, items: { type: 'string', maxLength: 200 } }
  }
};

// ---------------------------------------------------------------------------
// Validator: strict on structure, forgiving on harmless noise (trims strings,
// turns "" into null, drops unknown keys). Returns { ok, value, errors }.
// ---------------------------------------------------------------------------
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function clean(v, schema, path, errors) {
  const types = [].concat(schema.type || []);
  if (v === undefined) v = null;
  if (typeof v === 'string') { v = v.trim(); if (v === '' && types.includes('null')) v = null; }
  if (v === null) {
    if (types.includes('null')) return null;
    if (types.includes('array')) return [];
    errors.push(`${path} is required`); return undefined;
  }
  if (schema.enum && !schema.enum.includes(v)) { errors.push(`${path} must be one of ${schema.enum.filter(Boolean).join(', ')}`); return undefined; }

  if (types.includes('object') && typeof v === 'object' && !Array.isArray(v)) {
    const out = {};
    for (const [k, sub] of Object.entries(schema.properties || {})) {
      const r = clean(v[k], sub, `${path}.${k}`, errors);
      if (r !== undefined) out[k] = r;
    }
    for (const k of schema.required || []) if (!(k in out)) errors.push(`${path}.${k} is required`);
    return out;
  }
  if (types.includes('array') && Array.isArray(v)) {
    const items = v.slice(0, schema.maxItems ?? v.length).map((x, i) => clean(x, schema.items, `${path}[${i}]`, errors));
    return items.filter((x) => x !== undefined && x !== null);
  }
  if (types.includes('string') && typeof v === 'string') {
    if (path.endsWith('met_on') || path.endsWith('due_on')) {
      if (!DATE.test(v) || Number.isNaN(Date.parse(v))) return null;   // unusable date -> treat as unknown
    }
    return schema.maxLength ? v.slice(0, schema.maxLength) : v;
  }
  if (types.includes('integer') && Number.isInteger(v)) {
    if ((schema.minimum != null && v < schema.minimum) || (schema.maximum != null && v > schema.maximum)) return null;
    return v;
  }
  if (types.includes('boolean') && typeof v === 'boolean') return v;
  errors.push(`${path} has the wrong type`);
  return undefined;
}

export function validateCapture(raw, board = {}) {
  const errors = [];
  let parsed = raw;
  if (typeof raw === 'string') {
    const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    try { parsed = JSON.parse(text); } catch { return { ok: false, errors: ['Output was not valid JSON'] }; }
  }
  const value = clean(parsed, CAPTURE_JSON_SCHEMA, '$', errors);
  if (errors.length) return { ok: false, errors };

  // Cross-checks against the live board: unknown slugs become null instead of failing.
  const lanes = new Set(board.laneSlugs || []);
  const founders = new Set(board.founderSlugs || []);
  const sources = new Set(board.sourceSlugs || []);
  for (const f of value.founders) {
    if (f.lane_slug && lanes.size && !lanes.has(f.lane_slug)) f.lane_slug = null;
    if (f.match_slug && founders.size && !founders.has(f.match_slug)) f.match_slug = null;
    for (const s of f.sources) if (s.slug && sources.size && !sources.has(s.slug)) s.slug = null;
    f.sources = f.sources.filter((s) => s.slug || s.name);
    if (!f.match_slug && !f.person?.full_name && !f.person?.first_name && !f.company?.name) {
      errors.push('A founder entry has no match, no person name and no company name');
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
