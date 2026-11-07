// /AGENTS.md: everything an agent needs, generated from the code (schema-v3.js, tools.js) so it always
// matches what Bazooka checks. Served by api/agents-md.js; also at "/" when an agent asks for markdown.
import { SCHEMA_VERSION, SAVE_CONVERSATION, SAVE_PEOPLE, UPDATE_COMPANY, UPDATE_PERSON, SAVE_MESSAGE, MAX_PER_TYPE, MAX_SOURCES } from './schema-v3.js';
import { TOOLS } from './tools.js';

function typeName(s) {
  const t = [].concat(s.type || 'any').filter((x) => x !== 'null');
  let n = t[0] === 'array' ? `list of ${s.items?.type === 'object' ? 'objects' : (s.items?.type || 'any') + 's'}` : t[0];
  if (s.enum) n = s.enum.map((x) => `"${x}"`).join(' | ');
  if (s.format === 'uuid') n = 'id';
  if ([].concat(s.type).includes('null')) n += ' or null';
  return n;
}

// One line per field, nested objects and lists of objects expanded with dotted paths.
// Shared parts (founders, people, needs, follow-ups) are spelled out once, then referred back to.
const seen = new Map();
function fields(schema, prefix = '', out = []) {
  for (const [k, s] of Object.entries(schema.properties || {})) {
    const path = prefix + k;
    const req = (schema.required || []).includes(k) ? ', required' : '';
    const inner = s.properties ? s : s.items?.properties ? s.items : null;
    const before = inner && seen.get(inner);
    out.push(`- \`${path}\` (${typeName(s)}${req}): ${s.description || ''}${before ? `${/[.)]$/.test(s.description || '') ? '' : '.'} Same fields as \`${before}\` above.` : ''}`.trimEnd());
    if (inner && !before) { seen.set(inner, path); fields(inner, path + (inner === s ? '.' : '[].'), out); }
  }
  return out.join('\n');
}

const EXAMPLE = {
  schema: SCHEMA_VERSION,
  external_id: 'grok-chat-8812',
  company: { slug: null, name: 'Walkthru Health', one_liner: 'AI scribes for Indian clinics in Hindi and English', website: 'https://walkthru.example',
    domain: 'ai_native', sources: ['antler'], round: 'Seed, raising $1.5M', met_on: '2026-11-06' },
  founders: [{ name: 'Riya Kapoor', role: 'CEO', linkedin: 'https://www.linkedin.com/in/riya-kapoor-example' }],
  conversation: { date: '2026-11-06', title: 'Antler demo day', summary: 'Riya builds AI scribes for clinics. Live in 4 clinics. Needs her first clinic-chain customers. Piyush offered intros.', transcript: '<the full transcript>' },
  needs: { customer: 'First 10 clinic chains as paying customers', investor: null, advisor: null },
  where_we_are: 'Met at demo day; Piyush to intro 3 hospital-chain heads',
  people: [{ type: 'customer', name: 'Dr Arjun Mehta', linkedin: 'https://www.linkedin.com/in/arjun-mehta-example', title: 'Head of digital health',
    org: 'Example Hospitals', why: 'Runs digital rollout across 40 clinics; buys exactly this', degree: 1, origin: 'research' }],
  follow_ups: [{ task: 'Piyush to intro Riya to Dr Mehta', due: '2026-11-09' }],
  private_note: null,
  questions_for_piyush: ['Which hospital chain should go first?'],
};

// JSON with short objects and lists kept on one line, so the example stays readable.
function pretty(v, ind = '') {
  const flat = JSON.stringify(v);
  if (v === null || typeof v !== 'object' || flat.length + ind.length <= 100) return flat;
  const next = ind + '  ';
  if (Array.isArray(v)) return `[\n${v.map((x) => next + pretty(x, next)).join(',\n')}\n${ind}]`;
  return `{\n${Object.entries(v).map(([k, x]) => `${next}${JSON.stringify(k)}: ${pretty(x, next)}`).join(',\n')}\n${ind}}`;
}

const DEFAULT_PROMPTS_NOTE = 'get_company returns these filled in for the company (search_prompts.customer/investor/advisor). The admin can edit them.';

export function agentsMarkdown(origin, searchPrompts = {}) {
  seen.clear();
  const O = origin || '';
  const tools = TOOLS.map((t) => `| \`${t.name}\` | ${t.scope === 'board:read' ? 'read' : 'write'} | ${t.description.split('. ').slice(0, 2).join('. ').replace(/\|/g, '/').replace(/\.?$/, '.')} |`).join('\n');
  const prompts = ['customer', 'investor', 'advisor'].filter((t) => searchPrompts[t]).map((t) => `- **${t}:** ${searchPrompts[t]}`).join('\n');
  return `# Bazooka: read this first (for AI agents)

Bazooka is Piyush's founder tracker (Piyush is the founder of the InMobi group). For every company he meets it keeps the company and its founders (with LinkedIn), the conversations, what the company needs, the people from Piyush's network who could help (potential customers, investors and advisors), the messages sent, and how far along things are.

**You do all the thinking: reading transcripts, LinkedIn research, choosing people, writing messages. Bazooka only checks what you send, stores it and shows it to the team.** It runs no AI itself, so every call answers in well under a second. This works the same for any agent: Piyush's Grok bot, Instinct, or any other.

## 1. Connect
- Your token comes from the Bazooka admin and starts with \`bzk_\`. Send \`Authorization: Bearer <token>\` on every request. Keep it secret.
- **REST:** \`GET ${O}/api/agent\` lists your tools. \`POST ${O}/api/agent\` with \`{"tool": "<name>", "args": {...}}\` runs one.
- **MCP:** \`${O}/api/mcp\` (Streamable HTTP, JSON responses, stateless).
- The format is **${SCHEMA_VERSION}**. Saves carry \`"schema": "${SCHEMA_VERSION}"\`. If Bazooka says the version is wrong, read this file again.

\`\`\`bash
curl -s ${O}/api/agent -H "Authorization: Bearer $BAZOOKA_TOKEN" -H "Content-Type: application/json" \\
  -d '{"tool":"get_company","args":{"slug":"walkthru-health"}}'
\`\`\`

## 2. What to do

### A. Piyush shares a transcript or tells you about a meeting ("store it in Bazooka")
1. \`get_board\`. If the company is already there (same name or website), use its \`slug\`; then \`get_company\` to see what Bazooka already has. A new company gets \`company.slug: null\`.
2. From the conversation, work out: the company, the founders, what they need, where things stand, what was promised, and anything private.
3. **Needs:** only the types that were actually asked for (customer, investor, advisor), each as one specific line. Nothing asked = no needs.
4. **LinkedIn:** find each founder's LinkedIn profile. Find anyone named in the conversation as someone who could help (\`origin: "named"\`).
5. **Research:** for each needed type, search Piyush's LinkedIn using the search prompts (section 6). Up to ${MAX_PER_TYPE} people per type, 1st-degree connections first. Only real people you actually found, each with their LinkedIn link and one line on why they fit. If fewer than ${MAX_PER_TYPE} are genuinely good fits, send fewer and tell Piyush. Never pad.
6. Send everything in **one** \`save_conversation\` call. Show Piyush the \`show_piyush\` text it returns, and ask him \`questions_for_piyush\`.

### B. "Check company X" / "Where are we with X?"
\`get_company\` and tell Piyush: where we are, the people suggested and their status, open follow-ups, and the last conversation.

### C. "Find me 3 investors and 3 advisors for X among my 1st-degree space-tech founders"
\`get_company\`, then search LinkedIn following **Piyush's own words** (they override the default prompts), tied to what the company does and needs. Save with \`save_people\`: put his words in \`request\`, and add \`needs.<type>\` for any type the company doesn't have yet. Show him \`show_piyush\`.

### D. Messages
1. \`get_company\` gives the six message \`guides\`, \`guide_values\` and the people (with ids). Pick the guide that fits (e.g. \`intro_customer\` for a potential customer).
2. Write the message: \`{{...}}\` parts come from \`guide_values\` and the person; you write the \`[...]\` parts from the conversations and your research. Keep Piyush's voice: short and plain.
3. Show it to Piyush and save it with \`save_message\` (\`status: "draft"\`).
4. When he approves it: \`save_message\` with the \`message_id\` and \`status: "approved"\`, and \`update_person\` with \`status: "approved"\`. For now Piyush copies and sends it himself. When he confirms it went out: \`status: "sent"\`. The person becomes "intro sent" and the company moves to "Intros sent".
5. Never send anything unless Piyush has approved it in the chat.

### E. Updates
"They met" → \`update_person\` \`meeting_happened\`. "Declined" → \`declined\`. Anything new about the company → \`update_company\` (keep \`where_we_are\` current). Promises done → \`update_company\` \`follow_ups_done\`.

### F. Sources (where Piyush met them)
\`add_source\` / \`remove_source\`. A company usually has 1 source, at most ${MAX_SOURCES}.

## 3. Rules
- Record only what was said or what you actually found. Never invent people, LinkedIn links, numbers or facts.
- Search only for the types that were asked for, up to ${MAX_PER_TYPE} each.
- Anything Piyush calls private goes in \`private_note\` only: never in summaries, messages or \`where_we_are\`. You can't read private notes back.
- You can't delete companies. A person can undo anything you change; everything is logged under your name.
- Sending the same \`external_id\` twice returns the first result; nothing is saved twice.
- If Bazooka refuses a save, the error says exactly what to fix. Fix it and send again.

## 4. Tools
| Tool | Kind | What it does |
|---|---|---|
${tools}

## 5. The ${SCHEMA_VERSION} format

### save_conversation: example
\`\`\`json
${pretty(EXAMPLE)}
\`\`\`

### save_conversation: fields
null or a missing field means "no change" for an existing company.
${fields(SAVE_CONVERSATION)}

### save_people: fields
${fields(SAVE_PEOPLE)}

### update_company: fields
${fields(UPDATE_COMPANY)}

### update_person: fields
${fields(UPDATE_PERSON)}

### save_message: fields
${fields(SAVE_MESSAGE)}

### Stages
\`new\` (met) → \`connections_suggested\` → \`intros_sent\` → \`meeting_happened\` → \`feedback_captured\` → \`completed\`. The stage moves forward by itself: people saved → connections suggested; an intro sent → intros sent; a person met → meeting happened.

## 6. LinkedIn search prompts
${DEFAULT_PROMPTS_NOTE}
${prompts}
`;
}
