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
| `index.html` | The board: company-first cards, Sources section, buckets and domains, drag to reorder within a column, add/rename everywhere, six-stage status, editable company ID card, AI fill-in, messages |
| `capture.html` | Record → transcribe → thoughts → Send → results with undo |
| `login.html` | Email + password only (no emails are ever sent) |
| `admin.html` | Admin only: Team (add person, members, invites with invited-by, agents), Activity (paged log 50/page, undo, CSV/JSON, AI usage), AI and voice |
| `agents.html` | Public `/agents` page: how an agent connects (MCP/REST + token) and what it can do |
| `app/header.js` | The one header on every page (logo, Capture/Board/Admin toggle, settings menu) |
| `app/data.js` | The only browser code that talks to Supabase or `/api` (auth, board reads/writes, captures, admin) |
| `app/tokens.css` | Design tokens (dark only) and shared components |
| `api/ingest.js` + `api/_lib/capture.js` | Capture pipeline: board context → LLM → validate → `apply_capture` |
| `api/transcribe.js` | Azure en-IN transcription; deletes the audio afterwards |
| `api/autofill.js` + `api/_lib/autofill.js` | AI fills a company's empty message fields |
| `api/agent.js`, `api/mcp.js`, `api/_lib/tools.js` | 12 agent tools over REST and MCP |
| `api/admin.js` | Add people (no email), set passwords, agent tokens |
| `api/cleanup.js` | Daily: delete abandoned audio |
| `supabase/migrations/` | 8 migrations, all applied to the live project |
| `supabase/tests/` | Local Postgres harness + SQL tests; `remote-sql.sh` runs SQL on the live project |
| `tests/` | Unit tests; `e2e-live.mjs`, `agent-live.mjs` (live) |
| `docs/summary.md`, `docs/plan-v2.md` | What's built; the v2 plan (done) |

## Current state

_Last updated: 2026-11-06_

- **Logins:** 4 team accounts on @glance.com share one password set in Supabase (never in the repo). Adhithya (adhithya.sriram@glance.com) is the only admin. No email flows remain.
- **Plan v2 is built and pushed:** shared header, dark only, admin rework, company-first editable board with drag to reorder, sources section with sort/add/delete, Completed stage with delete, AI fill-in, `/agents` page.
- **Verified live:** board, panel and admin against real Supabase at 390/1024/1440 with a clean console; add → edit → complete → delete flow logged correctly; AI fill-in on Gemini; capture pipeline and agent tools (earlier).
- **Still needed from Adhithya:** turn off Vercel deployment protection (agents and teammates can't reach the site until then), add `CRON_SECRET` in Vercel.
- **Activity log** contains entries from live tests (actors "E2E test", "Live test agent", "UI test", "UI admin test", "System" for test cleanup).

## Next steps

1. Realtime board updates (Supabase Realtime) instead of reload-on-focus.
2. Show capture transcripts on each company's card; later push them to Notion.
3. Research agent; Notion sync once Notion exists.
