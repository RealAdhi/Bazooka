# Bazooka: what has been built

_As of 2026-11-07. Repo: `RealAdhi/Bazooka`, branch `main`, deployed by Vercel on every push (functions in `sin1`, Singapore). Database and logins: Supabase (`ap-southeast-1`)._

## What Bazooka is
Piyush's founder tracker. For every company he meets it keeps the company and its founders (with LinkedIn), the conversations, what the company needs, the people from his network who could help (potential customers, investors, advisors), the messages sent, and how far along things are.

**Bazooka is the output layer and tracker; agents do the work.** Piyush's Grok bot (which has LinkedIn access), each person's Instinct, or any other agent reads transcripts, searches LinkedIn, picks people and writes messages. It saves the results to Bazooka in one format (`bazooka-v3`). Bazooka runs no AI itself: it checks, stores and shows, and every call answers in well under a second.

## Pages
| Page | What it does |
|---|---|
| `login.html` | Email and password for the four team accounts. No emails are ever sent. |
| `index.html` (Board) | Sources on the left, three buckets with domain lanes, company cards (name, founders, where we are, sources, needs, a 6-step stage bar, delete with confirmation), lines from source dots to card dots. Loads in one database call. `/?company=<slug>` opens a card. |
| Company card | Stage, where we are, company details (one-liner, website, round, domain, met on, up to 2 sources), what they need (customers, investors, advisors), people who can help (grouped by type: LinkedIn link, title and organisation, degree, why, status), next steps, conversations (with transcripts), messages (draft, approved, sent), private note (people only). |
| `capture.html` | Record (Azure, Hinglish) or type, pick the company (or a new one), save. No AI: the transcript goes onto the card and the page gives a line to paste into your agent. |
| `admin.html` | Team (add people, members, invites, each person's agents with a 4-way selector, the **connect message** to copy with a new token), Activity (50 per page, undo, CSV and JSON, AI usage), **Agent prompts** (LinkedIn search prompts, six message guides, transcription, Bazooka's own AI switch, off). |
| `/AGENTS.md` | The agent guide, generated from the code. Also served at `/` to agents asking for markdown. `/agents` shows it to people. |

## Agent tools (REST `/api/agent`, MCP `/api/mcp`)
`get_board`, `get_company`, `save_conversation`, `save_people`, `update_company`, `update_person`, `save_message`, `add_source`, `remove_source`, `recent_activity`. All database-only. Agents can't delete companies or read private notes. Everything is logged under the agent's name and can be undone. Walkthrough: `docs/agent-flow.md`.

## Database (`supabase/migrations/`, 11 migrations, all applied live)
- Tables: members, invites, sources, buckets, lanes, people, companies, founders (the company listing), founder_team, founder_sources, connections (people suggested), conversations, drafts (messages), templates (message guides), variables, follow_ups, captures (every agent save and app recording), agents, settings, llm_usage, activity_log.
- `board_snapshot()` returns the whole board in one call (about 15 ms in the database).
- `save_v3()` applies a save in one transaction. It refuses duplicate companies and people for types the company doesn't need, replaces unacted suggestions of a type, matches people by LinkedIn link, and returns the first result on a retry.
- Database rules: at most 2 sources per company; at most 3 open suggestions per type; the stage moves forward by itself (people saved → suggested, intro sent → intros sent, met → meeting happened).
- Row-level security everywhere; append-only activity log with undo.

## Tests
- 22 unit tests (the format checks among them), and SQL tests on a throwaway Postgres: access, log, undo, invites, attribution, snapshot and save_v3 (limits, duplicates, retries, automatic stages).
- Live: the full agent flow over HTTPS on the deployed site (`docs/agent-flow.md`). The UI was checked at 390, 1024 and 1440 px with no console errors and no sideways scrolling.

## Decisions: before → now
| What | Before | Now |
|---|---|---|
| Who does the AI work | Bazooka's server (Gemini, Grok, Claude, OpenRouter) read captures and filled fields | The connected agent does everything; Bazooka's own AI is off (`ai_mode: "agent"`), with keys and code kept |
| Agent format | `submit_capture` with free text, then server AI, then `apply_capture` | `bazooka-v3` JSON straight from the agent, checked and saved by `save_v3` |
| Agent tools | 13 (get_overview, list_founders, get_founder, submit_capture, get_capture, update_founder, add_connection, update_connection, list_follow_ups, complete_follow_up, get_messages, fill_blanks, recent_activity) | 10 (get_board, get_company, save_conversation, save_people, update_company, update_person, save_message, add_source, remove_source, recent_activity) |
| Slow AI handling | 50 s timeout per model, 40 s answer then "processing" plus `get_capture` | Not needed: every call is database-only |
| Agent guide | Static `AGENTS.md` and `/agents` page | Generated `/AGENTS.md`, also at `/` for agents asking for markdown; `/agents` renders it |
| Connecting an agent | Token, plus "go to /agents" | Token plus a copyable connect message in Admin |
| Connections | 3 empty "Potential customer/investor/advisor" slots per company, filled by hand | Real people found by agents on LinkedIn: up to 3 per needed type, with link, why, degree and status; empty slots retired |
| Needs | A free list | One line each for customers, investors and advisors, only when asked for |
| Card fields | What stood out, recent signal, advice topic, strategy topic, conviction, InMobi customer, needs check, source event, notes, stage and raise, AI fill-in | Removed from the card (data kept). Added: where we are, round, people, conversations, messages, next steps, private note |
| Founders on the card | Editable name chips | Display only: names linked to LinkedIn, from the agent |
| Messages | Six templates filled with blanks on the card | Six message guides; the agent writes the message, Piyush approves, and Bazooka records draft, approved and sent |
| Sending | Agents never send | Agents send only after Piyush approves in the chat. For now he copy-pastes. |
| Transcripts | Stored on captures only | Stored per conversation, per company, on the card |
| Capture page | Record, then "Send" to the AI, then results and undo | Record or type, pick the company, save; paste-to-agent line |
| Sources per company | Any number | Usually 1, at most 2 (enforced) |
| Board load | 7 queries | 1 call (`board_snapshot`) |
| Admin AI tab | "AI and voice" (provider and models) | "Agent prompts" (search prompts, message guides, transcription; own AI collapsed and off) |
| Earlier decisions kept | Azure en-IN transcription (Deepgram optional); password-only logins, no emails; 4 @glance.com accounts; dark theme only; shared header with profile button; each person has their own Instinct, Grok bot is Piyush's; activity log 50 per page; six stages ending in Completed; delete on every card with confirmation; functions in Singapore | Same |
