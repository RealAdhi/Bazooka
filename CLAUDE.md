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
| `index.html` | The app (currently the v1 single-file dashboard with hardcoded data) |
| `docs/architecture.md` | Plan, agent hub design, schema draft, keys needed, open questions |
| `docs/brief-v1.md` | Original build brief for the single-file version |
| `CLAUDE.md` | This file |

Planned (see architecture doc): `admin.html`, `app/data.js`, `app/tokens.css`, `api/*`, `supabase/migrations/*`, `AGENTS.md`, `llms.txt`, `robots.txt`, `docs/prompts/*`.

## Current state

_Last updated: 2026-11-05_

- `index.html`: working v1 dashboard (map, founder overlay with six messages, future plans page). Hardcoded placeholder data, desktop first, read-only data layer.
- Decisions made: Supabase (email + password auth, magic link as fallback, invite only), Vercel, push to `main`, phone first, LLM providers Claude / Gemini / Grok (admin picks which is billed), Deepgram for speech-to-text and text-to-speech, SortableJS for drag and drop, no real data yet.
- Waiting on Adhithya: the four users' names and emails; keys and access listed in `docs/architecture.md` §9; answers to §10 open questions.

## Next steps

1. Get answers to the open questions; finalise schema.
2. Supabase migrations + RLS + auth (login page, invite flow), seed with today's placeholder data.
3. `app/data.js` with reads, writes and realtime; move `index.html` onto it.
4. Phone-first layout pass, then drag and drop, then admin portal.
5. Agent gateway (REST + MCP), orchestrator, research agent, Notion sync, voice.
