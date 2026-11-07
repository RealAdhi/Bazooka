# Bazooka — instructions for Claude

Read this first in every session. It is the shared memory between Adhithya's two laptops and every cloud session.

## What Bazooka is

Bazooka is the live surface of Piyush's founder network (Piyush: founder, InMobi group). Piyush meets founders through ecosystem sources (EF, Variance, Antler, SPC, Activate, Local Host, Bloomberg events…). For each founder Bazooka keeps the current state — who they are, what they do, where they came from, which bucket they sit in, what they need — finds the 3 most relevant connections from Piyush's network, drafts six ready-to-send intro and follow-up messages, and tracks outcomes.

- **Notion is the deep context layer** (meeting notes, relationship history). Bazooka is the thin, current, operational layer on top. It does not try to store everything.
- **Agents do the work; Bazooka is the output layer and tracker.** Piyush's Grok bot (LinkedIn access), each person's Instinct and any other agent read transcripts, research people on LinkedIn, write messages, and save results in the `bazooka-v3` format. Bazooka runs no AI of its own: it checks, stores and shows, fast.
- **Users:** four invited people. Adhithya is the only admin. Phone first, then laptop.
- **Targets this month:** 25 founders, 50 connections, 25 meetings, quality steady as volume rises.

Full detail: `docs/architecture.md` (current plan and schema) and `docs/brief-v1.md` (the original single-file brief, partly superseded).

## Workflow rules (always)

1. **Pull before editing:** `git pull --ff-only origin main` at the start of every task. Everything goes straight to `main`.
2. **Commit often.** One commit per small, complete step, with a clear message. Many small commits are the goal; they save work and show Adhithya's activity on GitHub.
3. **Push often.** Push after every few commits and at the end of every task. Cloud containers are wiped when idle and unpushed commits are lost (this already happened once).
4. **Attribution: none for Claude.** Commits are authored as `S S Adhithya Sriram <contact.adhithyasriram@gmail.com>`, unsigned. No `Co-Authored-By`, no session links, no "Generated with" lines in commits or PRs. In a fresh clone, set:
   ```
   git config user.name "S S Adhithya Sriram"
   git config user.email "contact.adhithyasriram@gmail.com"
   git config commit.gpgsign false
   ```
5. **Update "Current state" below on every push** so the next session (on either laptop) can recap in one read.
6. **Never** put API keys, tokens or passwords in code, commits or chat. They live in Vercel env vars, Supabase secrets, or the cloud environment's secrets.

## Tech rules

- Plain HTML, CSS and JavaScript (ES modules). No framework, no build step.
- Inline CSS and JS by default. Split into a file only when it is shared by two pages, is the data layer, or is server code in `api/`.
- CDN libraries only, exact pinned versions (GSAP 3.13.0 + DrawSVG, supabase-js v2, SortableJS). Page must still render if a CDN fails.
- Hosting: Vercel (static pages + `api/` serverless functions). Database and auth: Supabase. Code: GitHub `RealAdhi/bazooka`, branch `main`.
- **All UI reads and writes go through `dataSource`** (`app/data.js`). No page talks to Supabase directly.
- HTML-escape every data string on render. Data comes from people and agents and is untrusted.
- Row-level security on every table. The browser only ever has the public anon key.
- Agent input is untrusted: every save is checked against `api/_lib/schema-v3.js` and refused with exact errors. Agents send messages only after Piyush approves them in the chat (Bazooka itself never sends). Agents can't delete companies or read private notes. Everything is logged in `activity_log` and can be undone.
- **No AI on our side.** Don't add server-side LLM calls to the agent path; the old ones (`api/_lib/capture.js`, `llm.js`, `autofill.js`) stay switched off behind `settings.ai_mode`.
- `/AGENTS.md` is generated (`api/_lib/agents-md.js`) from `schema-v3.js` and `tools.js`. Change the format there, never in a static copy.
- Never invent real people. Placeholders until real data is approved. Private notes never appear in any draft.

## Design rules

- **Phone first**, then 1024px, then 1440px. Keep the current visual language: "the whiteboard, made precise" — cool board surface, black ink for structure, marker blue (Ecosystem), marker red (Moonshot), marker green (Unlock). Dark theme = the board at night.
- One bold moment: connector lines drawing themselves on load. Everything else is quiet. Respect `prefers-reduced-motion`.
- Avoid: cream + terracotta, near-black + one acid accent, generic rounded SaaS cards with grey shadows, ALL-CAPS eyebrows, middle-dot meta strings, decorative mono labels, "→" on buttons. Numbers only for real sequences.
- Copy: plain, sentence case, active verbs. Empty states invite action. Errors say what happened and what to do.
- Skills: frontend-design leads the design; Impeccable (critique → audit → polish) and web-design-guidelines review; webapp-testing / Playwright for screenshots. Don't let two style systems fight.
- Before saying a UI task is done: screenshot at 390px, 1024px and 1440px in light and dark, look at them, check the console is clean, keyboard works, contrast ≥ 4.5:1.

## File map

| Path | What |
|---|---|
| `index.html` | The board (one call: `board_snapshot`) and the company card (where we are, company, needs, people, next steps, conversations, messages, private note). `/?company=<slug>` opens a card |
| `capture.html` | Record or type → pick the company → save as a conversation (no AI) |
| `login.html` | Email + password only (no emails are ever sent) |
| `admin.html` | Team (people, agents per person, connect message), Activity (log, undo, CSV/JSON, AI usage), Agent prompts (search prompts, message guides, transcription, own-AI switch) |
| `agents.html` | `/agents`: renders `/AGENTS.md` for people |
| `middleware.js` | Agents asking `/` for markdown get `/AGENTS.md` |
| `app/header.js`, `app/data.js`, `app/tokens.css` | Shared header; the only browser data layer; design tokens (dark only) |
| `api/_lib/schema-v3.js` | The `bazooka-v3` format: tool inputs, checks, field docs (single source of truth) |
| `api/_lib/tools.js`, `api/agent.js`, `api/mcp.js` | The 10 agent tools over REST and MCP |
| `api/_lib/agents-md.js`, `api/agents-md.js` | Generates and serves `/AGENTS.md` |
| `api/transcribe.js` | Azure en-IN transcription; deletes the audio afterwards |
| `api/admin.js` | Add people, set passwords, agent tokens |
| `api/ingest.js`, `api/autofill.js`, `api/_lib/{capture,llm,prompts,autofill,ai-mode}.js` | Old server-side AI, switched off (410) unless `ai_mode = "server"` |
| `supabase/migrations/` | 11 migrations, all applied live (latest: `board_snapshot`, `agent_first` with `save_v3`) |
| `supabase/tests/` | Local Postgres harness + SQL tests; `remote-sql.sh` runs SQL on the live project |
| `tests/` | Unit tests (`node --test tests/*.test.js`); live scripts |
| `docs/summary.md` | What's built, and every decision before → now |
| `docs/agent-flow.md` | The agent flow, tested live step by step |

## Current state

_Last updated: 2026-11-07_

- **Agent-first is live.** Bazooka's own AI is off (`settings.ai_mode = "agent"`). Agents save with `save_conversation` / `save_people` in `bazooka-v3`; 10 database-only tools answering in about 0.05–0.45 s on the server. Full live test: `docs/agent-flow.md`.
- **Connecting an agent:** Admin → Team → Agents → pick the person → Create token → copy the connect message (site, `/AGENTS.md`, token) into the agent.
- **AGENTS.md** is generated, served at `/AGENTS.md`, and at `/` for `Accept: text/markdown` (via `middleware.js`).
- **Board:** loads in one call; cards show where we are and needs; the company card is simplified (removed: what stood out, recent signal, advice/strategy topic, conviction, InMobi customer, needs check, source event, notes, AI fill-in; the data is kept in the database).
- **Data:** conversations per company; people with LinkedIn, why, degree, origin and status; messages draft → approved → sent; at most 2 sources per company, at most 3 open suggestions per type; the stage moves forward by itself.
- **Logins:** 4 team accounts on @glance.com share one password set in Supabase (never in the repo). Adhithya is the only admin. Vercel deployment protection is off.
- **Still needed:** `CRON_SECRET` in Vercel (daily audio cleanup). `OPENROUTER_API_KEY` only if Bazooka's own AI is ever turned back on.

## Next steps

1. Give Piyush's Grok bot its token and connect message; run one real conversation end to end.
2. When Piyush wants it: agents send approved messages themselves (record with `save_message` status sent).
3. Realtime board updates (Supabase Realtime) so agent saves appear without a reload.
4. Notion sync once Notion exists.
