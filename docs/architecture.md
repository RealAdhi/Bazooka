# Bazooka — architecture and plan

_Draft 1 · 2026-11-05 · owner: Adhithya_

## 0. Decisions log

**2026-11-05, round 2**
- **Users:** Piyush, Mangala, Amog, Adhithya. Adhithya is the only admin. Emails to come; accounts are created by invite from the admin panel.
- **Every logged-in user can edit everything** (entities, status, connections, drafts). Every change by a person or an agent is logged; the admin panel shows the full log and can download it (CSV and JSON).
- **Notion does not exist yet.** It stays in the design as the future deep-context layer and future primary LLM, but nothing depends on it today. The "which sources can write facts" question is parked until Notion exists.
- **LLM provider order:** Notion AI (once it exists and if it can be called) → Grok (Piyush's key) → admin's toggle between Claude / Gemini / Grok. Gemini is the free default. No spending cap needed. Vercel plan is not a constraint.
- **Capture is the first feature to build** (§7a): one big record button → Deepgram transcript → Piyush adds thoughts (typed or voice) → Send → LLM classifies and returns strict JSON → Bazooka applies it and shows what changed.
- **The same pipeline serves every interface.** Grok bot, Instinct, Notion AI and the website all send a transcript (+ optional notes) to one ingest endpoint. Piyush answers the same five questions (§7b) wherever he talks.
- **Files live in Supabase Storage** (private bucket), not on the device and not on Vercel.
- **Approval = the capture flow itself.** On the website, hitting Send is the approval. Through Grok / Instinct, sending the note is the approval. No separate daily digest for now.

## 1. What Bazooka is, in one picture

```
             deep context (meeting notes, relationship history)
   ┌──────────────────────────── Notion Enterprise ───────────────────────────┐
   │   Founders DB · People DB · meeting pages · Notion AI / Custom Agents    │
   └───────────▲───────────────────────────────▲──────────────────────────────┘
     API sync  │ (data, two-way)        MCP    │ (Notion AI as an agent, two-way)
               │                               │
   ┌───────────┴───────────────────────────────┴──────────────────────────────┐
   │                         BAZOOKA  (this repo)                             │
   │  current state only: who, what they do, source, bucket, status, needs,   │
   │  3 connections, 6 drafts, follow-ups, gaps, activity log                 │
   │                                                                          │
   │  Web app (phone first) ── 4 users, drag and drop, voice                  │
   │  Agent gateway  ─────────  REST + MCP, per-agent tokens                  │
   │  Orchestrator  ──────────  LLM (Claude / Gemini / Grok, admin picks)      │
   └───────▲──────────────────▲───────────────────▲────────────────▲──────────┘
           │ two-way          │ two-way           │ two-way        │ outbound only
     Piyush's Grok bot     Instinct          Notion AI        Research agent
     (LinkedIn, his ctx)   (WhatsApp agent)                   (LLM + web search)
```

**Rule of thumb:** if it is history or long-form context, it lives in Notion. If it is *current state you act on today*, it lives in Bazooka. Bazooka stores a `notion_page_id` on every record so it can always fetch the deep context on demand.

## 2. What exists today vs what's needed

| Area | Built in v1 `index.html` | Needed |
|---|---|---|
| Map (sources → buckets → lanes → founders, lines) | Yes, desktop first | Phone-first layout, live data, add/edit, drag and drop, realtime |
| Founder overlay (3 connections × 6 messages, fill-in fields, copy/WhatsApp/email) | Yes | Values from DB/Notion, saved drafts, "mark as sent" → status + follow-up |
| Progress strip, filters, search | Yes | Same, on live data |
| Future plans page | Static content | Becomes "How it works" + live system status (agents, gaps, spend) |
| Login | No | Supabase Auth: email + password, magic link fallback, invite only |
| Admin portal | No | Users, agents & tokens, LLM provider & budget, templates, variables, lanes/buckets, audit log |
| Agent access | No | Gateway (REST + MCP), `AGENTS.md`, `llms.txt`, `robots.txt`, `openapi.json` |
| Two-way agent conversations | No | Orchestrator + threads + job queue + system prompts |
| Missing info ("needs check") | Static marker | `gaps` table + resolution ladder (§5) |
| Voice | No | Deepgram STT in, orchestrator, Deepgram TTS reply |
| Data | 16 hardcoded placeholders | Supabase, seeded with the same placeholders; real data later |

## 3. File layout (no build step)

```
index.html          app: login, #map, #pipeline, #future, playground (CSS + UI JS inline)
admin.html          admin portal (admin role only)
app/tokens.css      shared design tokens (index + admin)
app/data.js         dataSource: Supabase client, reads, writes, realtime — the only seam to the DB
api/                Vercel serverless functions (Node); secrets only exist here
  agent/[...].js    REST for agents (token auth)
  mcp.js            same tools over MCP (Streamable HTTP)
  voice.js          audio → Deepgram → orchestrator → reply (+ TTS)
  worker.js         runs queued jobs (called by cron)
  admin.js          invite/remove users, mint/revoke agent tokens
  _lib/             llm.js (Claude/Gemini/Grok adapter), notion.js, deepgram.js, tools.js, prompts.js
supabase/migrations/*.sql   schema, RLS, seed
AGENTS.md  llms.txt  robots.txt  openapi.json
docs/prompts/*.md           every system prompt, versioned
vercel.json  package.json   (package.json only for api/ dependencies)
```

## 4. Users, auth, roles

- Supabase Auth, **public sign-up off**. Admin invites by email → user sets a password. Login = email + password; "Forgot password" sends a magic link.
- `members` table holds the allow-list and role (`admin` | `member`). Adhithya is the only admin. The list is editable in the admin portal (add, deactivate, change role).
- RLS: every table readable/writable only if `auth.uid()` is an active member; admin-only tables check role.
- Agents never log in as users. Each agent has its own token (stored hashed), its own scopes, and acts through `api/` with the service key.
- Auth emails: Supabase's built-in mailer is heavily rate-limited, so use a custom SMTP sender (e.g. Resend) from day one.

## 5. The two-way agent hub (the core idea)

### 5.1 Every outside system is an "agent" with two directions

| Agent | They → Bazooka (inbound) | Bazooka → them (outbound) |
|---|---|---|
| **Piyush's Grok bot** | Grok calls Bazooka's MCP server / REST with its token ("add this founder", "what's pending?") | Bazooka asks Grok a question (e.g. "LinkedIn headline and current role of X?") via the xAI API — **to confirm what the key reaches (§10 Q3)** |
| **Instinct** | Instinct calls our REST endpoint (if it can make web requests) or forwards to a capture email | Depends on what Instinct exposes (API? email? only WhatsApp?) — **§10 Q4** |
| **Notion AI / Custom Agents** | Custom Agent calls Bazooka's MCP (Notion supports MCP connections for Custom Agents) | We mostly don't need Notion AI here: we read/write Notion **data** directly through the Notion API |
| **Notion data** | Notion webhooks on page changes → sync into Bazooka | Notion API: read properties, search pages, write back status |
| **Research agent** | — | Our own LLM call (Claude / Gemini / Grok) with web search, used as a fallback |
| **Humans (4 users)** | App, voice | Approval queue, daily digest |

### 5.2 Orchestrator

Every incoming thing — a voice note, a message from Grok or Instinct, a Notion change, a research result — becomes an **event** in a thread. The orchestrator (one LLM call loop with tools, system prompt `docs/prompts/orchestrator.md`) decides one of:

1. **Act**: create/update/move entities, add connections, fill a field.
2. **Reply** to whoever sent it (in their thread).
3. **Ask** another agent something (opens or continues an outbound thread).
4. **Escalate** to a human (approval queue / digest).
5. **Do nothing** (duplicate, irrelevant).

Guards so agents can't loop or run up a bill: max hops per thread, no re-asking the same agent the same question, per-day spend cap per provider, idempotency keys on inbound messages, every action logged and undoable, destructive or outward-facing actions always need approval.

### 5.3 Filling missing information — the resolution ladder

To your question "do we depend on the research agent?" — **no, it is the last rung.** For each missing field the system walks down until something answers:

1. **Bazooka DB** — already known elsewhere (e.g. company one-liner on another founder record).
2. **Notion, deterministic** — read the exact Notion property mapped to this variable. No LLM, no cost.
3. **Notion, search + extract** — search Notion pages for the person, LLM extracts the field with a quote as evidence.
4. **Piyush's Grok bot** — has his LinkedIn and his context; ask it a structured question.
5. **Instinct** — if reachable.
6. **Research agent** — LLM + web search (provider = admin's choice).
7. **Ask a human** — goes into the digest ("2 things I couldn't find").

Answers from rungs 3–6 land as **proposed values** with source, evidence and confidence. Admin policy decides which sources auto-accept (e.g. Notion property = auto; web research = needs a tap). This replaces today's static "needs check" marker.

Note: rungs 3–6 all need *an* LLM to reason, so the orchestrator always needs one active provider key. The "research agent" is just that same provider with a web-search tool turned on.

### 5.4 Template variables straight from Notion — yes, and it's the best design

The six templates already use named variables (`{{connection_title}}`, `{{one_liner}}`…). Make that a first-class **variable registry** (`variables` table): one row per variable with its label, which entity it belongs to, which Bazooka column holds it, **which Notion property it maps to**, and how to fill it (`direct` | `notion` | `llm` | `manual`).

- If the Notion Founders/People databases use the **same property names** as the variables, filling is a plain lookup — exact, free and auditable.
- Fields that are judgement, not fact (`founder_highlight`, `connection_relevance`, `strategy_topic`) are `llm`: generated from Notion meeting notes, shown as a suggestion, editable.
- The registry is also what every prompt reads, so all agents speak the same field names.

### 5.5 System prompts to write (`docs/prompts/`)

| Prompt | Used by | Job |
|---|---|---|
| `orchestrator.md` | Bazooka brain | Decide act / reply / ask / escalate; tool rules; safety |
| `inbound-contract.md` | Pasted into Grok bot, Instinct, Notion Custom Agent | "How to talk to Bazooka": endpoints, token, verbs, field names, examples |
| `ask-agent.md` | Outbound questions | Ask one precise question for one field, demand structured answer + source |
| `research.md` | Research agent | Find a field on the web, cite URL, say "not found" rather than guess |
| `parser.md` | Voice notes, transcripts | The v1 parser prompt, updated to the schema |
| `drafting.md` | LLM-filled variables | Write `founder_highlight`, `connection_relevance` etc. in Piyush's voice |
| `ranker.md` | Connection suggestions | Score `0.5·fit + 0.3·closeness + 0.2·stature`, one-line reasons |

## 6. Phone-first UI and drag and drop

- **Phone:** progress as a compact strip; bucket tabs (Ecosystem / Moonshot / Unlock); lanes as stacked sections; sources as coloured chips (lines are a tablet/desktop feature, plus a "show sources" focus mode on phone); founder overlay becomes a full-screen sheet with messages as a swipeable stack; voice button fixed bottom-right.
- **Second view, "Pipeline":** columns by status (new → suggested → sent → meeting → feedback). Most useful on phone.
- **Drag and drop (SortableJS, long-press on touch):**
  1. Founder between lanes / buckets → changes lane (and therefore bucket).
  2. Reorder founders inside a lane → priority.
  3. Founder between status columns (Pipeline view) → changes status, adds timeline date.
  4. Person from "Network" drawer onto a founder → proposes a connection.
  5. Admin/playground: reorder lanes and buckets, drag a lane into another bucket.
- Every drag has a **"Move to…" menu** equivalent (keyboard, accessibility, and a fallback on small screens), an undo toast, and an activity-log entry. Other users see the move live (Supabase Realtime).

## 7. Voice

- In app: hold the mic → record → `api/voice` → Deepgram speech-to-text → orchestrator (parser prompt) → proposed actions shown as a confirm card ("Add Asha · EF · Bio-Science?") → one tap → done; Deepgram text-to-speech reads the result back (optional).
- Via agents: WhatsApp voice note to Instinct or a Grok voice session → that agent calls Bazooka's gateway → same orchestrator, same log.
- The Deepgram key never reaches the browser.

## 7a. Capture flow (build first)

```
[● Record]  big button, any device
    │  MediaRecorder (webm/opus, or mp4 on iPhone Safari), screen wake lock while recording
    ▼
[■ Stop] → upload audio straight from the browser to Supabase Storage  (bucket: captures, private)
    │       (audio never passes through Vercel: its request body limit is 4.5 MB)
    ▼
api/transcribe → signed URL → Deepgram pre-recorded (nova-3, smart_format, diarize, paragraphs)
    │  Deepgram fetches the file itself; transcript saved on the capture row
    ▼
Transcript shown  +  "Your thoughts" box (type, or a second smaller mic → same Deepgram path)
    ▼
[Send] → api/ingest → LLM (provider per §0) with docs/prompts/capture.md + list of existing
    │     founders/sources/lanes so it can match instead of duplicating
    │     → strict JSON (schema in the prompt) → server-side validation → apply to DB
    ▼
Result card: "Added PopVax (Bio-Science, Bloomberg). Updated Prava: meeting happened."
             each line has Undo · everything in activity_log
```

- Long meetings: a 1-hour opus recording is ~15–30 MB. Supabase's default upload limit is 50 MB per file (raise it in Storage settings for longer ones).
- If the upload or transcription fails, the audio stays on the capture row with an error and a Retry button. Nothing is lost.
- Capture status: `recording → uploaded → transcribed → sent → processed | failed`.

## 7b. The five questions (same in every interface)

Piyush answers these by talking, in any order, to the website, Grok bot, Instinct or Notion AI:

1. **Who did you meet?** Name, company, what they're building.
2. **Where and how?** Source or event, and when.
3. **What do they need?** Customers, investors, advisors, hires, and specifically what.
4. **Who can help, and why?** Names from your network.
5. **What did you promise, and what's next?** Plus anything private (say "private" and it never goes in a message).

Bucket, domain, stage and status are worked out by the LLM from the answers.

## 8. Schema draft (for discussion, not final)

Conventions: `uuid` ids, `created_at/updated_at/created_by`, soft delete via `archived_at`, `notion_page_id` where it mirrors Notion, RLS on all.

**People and orgs**
- `members` — the 4 users: auth user id, name, email, role, active.
- `people` — every human: founders and Piyush's network. Name, first name, headline, linkedin, email, whatsapp, city, tags, notion_page_id. *(Never invented; placeholders flagged.)*
- `companies` — name, one_liner, website, stage, domain tags, notion_page_id.
- `person_companies` — who works where, title, current or not. (Fixes the "Kunal–Keshav" kind of ambiguity: person and company are separate.)

**Structure (editable in the playground)**
- `sources` — EF, Variance… kind (program / fund / event / community), expected count, tentative, group.
- `events` — a specific event under a source (e.g. "Bloomberg event, Oct 2026"), date.
- `buckets` — name, ink colour, order.
- `lanes` — bucket, name, slot target, order.

**The main record**
- `founders` — one tracked founder: person, company, lane, position, status, stage, raise_clause, needs, founder_highlight, recent_signal, strategy_topic, advice_topic, conviction, customer_tick, met_on, owner (member), private_notes (never exported to drafts).
- `founder_sources` — founder × source (× event); many-to-many, so Locksmith Bio has two.

**Intros and messages**
- `connections` — founder × person, type (customer / investor / advisor), reason, fit / closeness / stature scores, rank, status (suggested → approved → sent → meeting → declined), suggested_by.
- `templates` — key, title, channel, subject, body, active, version.
- `variables` — the registry from §5.4.
- `drafts` — founder × connection × template, rendered text, field overrides, status, sent_at, sent_by.
- `follow_ups` — due date, status, outcome text.

**Knowledge quality**
- `field_provenance` — for any entity field: where the value came from, evidence, confidence, verified by.
- `gaps` — missing field, current rung, attempts, proposed value, status (open / asking / proposed / filled / needs human / unresolvable).

**Agents and automation**
- `agents` — Grok bot, Instinct, Notion AI, research: token hash + prefix, scopes, trust level, enabled, outbound config (no secrets).
- `threads` and `agent_messages` — two-way conversations, direction, payload, correlation id, idempotency key, hop count.
- `jobs` — queue: kind, payload, run_after, attempts, status, result.
- `approvals` — proposed action, from whom, decided by.
- `activity_log` — actor (member / agent / system), action, entity, before, after. Drives undo and the timeline.
- `settings` — active LLM provider + model, daily budget, auto-accept policy.
- `llm_usage` — provider, model, tokens, estimated cost, purpose.
- `voice_notes` — audio path, transcript, parsed actions, status.

Open schema points: is `founders` one-per-person forever, or one per "engagement" (same founder, second company later)? Should Piyush's network (`people` with a `network` tag) carry closeness/stature scores here, or only in Notion?

## 9. Keys, services and access needed

Add secrets in the **cloud environment's settings** (environment menu in the session title bar → Edit → Network secrets / environment variables) and in **Vercel → Project → Environment Variables**. Never paste them in chat.

| # | Service | What | Env var name |
|---|---|---|---|
| 1 | Supabase | Project URL, anon (publishable) key | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| 2 | Supabase | Service role (secret) key — server only | `SUPABASE_SERVICE_ROLE_KEY` |
| 3 | Supabase | Personal access token or DB connection string, to run migrations from the session | `SUPABASE_ACCESS_TOKEN` or `SUPABASE_DB_URL` |
| 4 | Vercel | Project connected to `RealAdhi/Bazooka` (you do this in Vercel); a token if I should set env vars / read deploy logs; **which plan** (Hobby crons run once a day — the job worker needs every minute, else we use Supabase `pg_cron`) | `VERCEL_TOKEN` |
| 5 | Anthropic | Claude API key | `ANTHROPIC_API_KEY` |
| 6 | Google | Gemini API key | `GEMINI_API_KEY` |
| 7 | xAI | Grok API key (research / LLM provider) | `XAI_API_KEY` |
| 8 | Piyush's Grok bot | Whatever reaches *his* bot specifically (may differ from #7) | `GROK_BOT_*` |
| 9 | Deepgram | API key (STT + TTS) | `DEEPGRAM_API_KEY` |
| 10 | Notion | Internal integration token, shared with the Founders and People databases; their database IDs | `NOTION_TOKEN`, `NOTION_FOUNDERS_DB`, `NOTION_PEOPLE_DB` |
| 11 | Email (SMTP) | Sender for login / magic-link emails (e.g. Resend) + a domain to send from | set in Supabase Auth settings |
| 12 | Instinct | Whatever interface it has (API, webhook, email address) | `INSTINCT_*` |
| 13 | Domain (optional) | e.g. bazooka.something for Vercel | — |
| 14 | Network access | Allow this cloud environment to reach: `*.supabase.co`, `api.supabase.com`, `api.vercel.com`, `api.notion.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, `api.x.ai`, `api.deepgram.com` | environment settings |

## 10. Open questions

1. **Users:** names and emails of the four. ("Aditya" = you, Adhithya?)
2. **Founders per person:** one record per founder forever, or one per engagement?
3. **Piyush's Grok bot:** is it reachable by API (a specific agent/bot ID with his connectors), or does the xAI key only give the plain model? If only the model, then "ask Piyush's Grok" works inbound (he talks to Grok, Grok calls us) but not outbound.
4. **Instinct:** can it call a URL / webhook? Does it have an email address or API? If it's only reachable on WhatsApp, Bazooka can't message it without a WhatsApp Business number (and Instinct's terms say personal use).
5. **Notion:** do Founders and People databases already exist? Can we name their properties to match our variable names?
6. **Auto-accept policy:** which sources can write facts without a human tap? Suggest: Notion properties yes; Grok bot and research → proposed.
7. **Approvals:** Piyush approves intros in a daily digest (where — Grok bot, WhatsApp, email, in app?).
8. **Vercel plan:** Hobby or Pro?
9. **LLM spend cap:** a daily budget per provider?
