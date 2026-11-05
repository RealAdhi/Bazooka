# Bazooka — instructions for Claude

Read this first in every session. It is the shared memory between Adhithya's two laptops and every cloud session.

## What Bazooka is

Bazooka is the live surface of Piyush's founder network (Piyush: founder, InMobi group). Piyush meets founders through ecosystem sources (EF, Variance, Antler, SPC, Activate, Local Host, Bloomberg events…). For each founder Bazooka keeps the current state — who they are, what they do, where they came from, which bucket they sit in, what they need — finds the 3 most relevant connections from Piyush's network, drafts six ready-to-send intro and follow-up messages, and tracks outcomes.

- **Notion is the deep context layer** (meeting notes, relationship history). Bazooka is the thin, current, operational layer on top. It does not try to store everything.
- **Bazooka is a two-way hub for agents.** Instinct, Piyush's Grok bot, Notion AI and our own research agent can all send to Bazooka and be asked things by Bazooka.
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
- Agent input is untrusted. Agents never send messages to humans; destructive actions go to the approval queue; everything is logged in `activity_log` and can be undone.
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
| `index.html` | The board (v1 map with placeholder data, now behind login, with Capture/Admin links) |
| `capture.html` | Phone-first capture: record → transcribe → thoughts (typed or spoken) → Send → results with undo |
| `login.html` | Email + password, emailed sign-in link, set password after invite |
| `admin.html` | Admin only: team + invites, activity log (undo, CSV/JSON download), AI and voice settings, agent tokens, usage |
| `app/data.js` | The only browser code that talks to Supabase or `/api` (auth, captures, admin, log) |
| `app/tokens.css` | Shared design tokens and components |
| `api/ingest.js` | One capture pipeline for website and agents: board context → LLM → validate → `apply_capture` |
| `api/transcribe.js` | Transcribes audio already in Storage (Azure en-IN by default, Deepgram optional) |
| `api/admin.js` | Invite by email (Supabase sends it), mint/revoke agent tokens |
| `api/config.js` | Public Supabase URL + anon key for the browser |
| `api/_lib/` | `capture-schema.js`, `prompts.js`, `llm.js`, `speech.js`, `auth.js`, `supabase.js`, `http.js` |
| `supabase/migrations/` | Schema, activity log + RLS + undo, `apply_capture`, storage, invites |
| `supabase/seed.sql` | Whiteboard placeholders, templates, variables, agents, settings |
| `supabase/tests/run-local.sh` | Applies everything to a throwaway local Postgres and runs SQL tests |
| `tests/*.test.js` | Node unit tests (`npm test` runs these and the SQL tests) |
| `AGENTS.md`, `llms.txt`, `robots.txt` | Agent instructions; crawlers blocked |
| `docs/setup.md` | Env var names and one-time Supabase / Vercel setup |
| `docs/architecture.md` | Plan, decisions log, agent hub, capture flow, schema notes |
| `docs/prompts/` | Prompt docs and the agent inbound contract |

## Current state

_Last updated: 2026-11-05 (evening)_

- **Supabase is live:** 7 migrations + seed applied, sign-up off, Adhithya (adhithya.sriram@inmobi.com) is admin in Auth. Run SQL with `supabase/tests/remote-sql.sh` (Management API over HTTPS; direct Postgres connections don't work from cloud sessions).
- **Verified end to end on real services:** synthetic Hinglish recording → Azure `en-IN` transcript with speakers (~10 s) → audio deleted → Gemini (`gemini-flash-latest`, with retry/fallback) → board updated → undo. Script: `tests/e2e-live.mjs`.
- **Agent-first:** 11 tools in `api/_lib/tools.js`, served at `/api/mcp` (MCP) and `/api/agent` (REST); every tool tested live via `tests/agent-live.mjs`. Agent writes are attributed by name in the log. `AGENTS.md` is the agent guide. Admin can add agents, switch read/write, mint tokens.
- **Board** (`index.html`) reads live data from Supabase (still read-only; edits in the founder panel aren't saved yet). Not yet phone-first.
- **Vercel:** deploys on every push to `main`. The site is behind Vercel Authentication (deployment protection) until Adhithya turns it off — agents can't reach it until then.
- **Env in cloud sessions:** Azure key is `speech_key` (region eastus); Gemini only (no xAI / Anthropic keys yet). Node needs `NODE_USE_ENV_PROXY=1` to reach the internet.
- **Activity log** holds entries from live tests (actors "E2E test", "Live test agent", "UI test"); the log is append-only.

## Next steps

1. Adhithya: turn off Vercel deployment protection, add `CRON_SECRET`, list the UI issues.
2. Board: phone-first layout; save edits from the founder panel (fields, status, connections) through `app/data.js`; realtime updates; drag and drop (SortableJS).
3. Show transcripts per founder (and later push them to Notion).
4. Research agent; Notion sync once Notion exists.
