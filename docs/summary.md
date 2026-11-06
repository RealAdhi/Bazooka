# Bazooka: what has been built so far

_As of 2026-11-06. Repo: `RealAdhi/Bazooka`, branch `main`, deployed by Vercel on every push. Database and logins: Supabase._

## What Bazooka is
The live, current-state surface of Piyush's founder network. Every company Piyush meets sits on one board, sorted by source and by bucket and domain. It shows what each company needs, the 3 most useful people to connect them with, six ready-to-send messages, and where each one stands. Notion will hold the deeper context (call records, meeting notes). Bazooka is the thin layer on top that people and agents act on.

## Pages
| Page | What it does today |
|---|---|
| `login.html` | Email and password sign-in for the invited team. |
| `index.html` (Board) | The whiteboard map: sources on the left; three buckets (Ecosystem, Moonshot #1, Unlock) holding domain lanes; company cards with source lines drawn on load. Clicking a card opens its details: 3 connections and 6 message drafts with Copy, WhatsApp and Email buttons. Live data from Supabase. |
| `capture.html` | A big record button. Audio goes to Supabase Storage, Azure transcribes it (Hinglish, by speaker), the audio is deleted, and you add your thoughts by typing or voice. Send: the AI updates the board and lists what changed, with Undo. |
| `admin.html` | Admin only: team, activity log (filters, undo, CSV/JSON download), AI and voice settings, agent tokens, AI usage. |

## Server (Vercel functions in `api/`)
| Endpoint | What it does |
|---|---|
| `/api/transcribe` | Transcribes audio already in Storage (Azure `en-IN` by default, Deepgram optional), then deletes the audio. |
| `/api/ingest` | The capture pipeline. It reads the live board, asks the AI for strict JSON (Notion first when it exists, then Grok, then the admin's pick; Gemini today), validates it, and applies it in one database transaction with `apply_capture`. Busy or retired models are retried and fall back. |
| `/api/agent` | REST for agents: `GET` lists tools, `POST {tool, args}` runs one. |
| `/api/mcp` | The same 11 tools as an MCP server (Streamable HTTP, stateless). |
| `/api/admin` | Admin actions: add people, create and revoke agent tokens. |
| `/api/config` | The public Supabase URL and anon key for the browser. |
| `/api/cleanup` | A daily job that deletes audio left untranscribed for 24 hours. |

## Database (Supabase, `supabase/migrations/`)
- **Tables:** members, invites, sources, buckets, lanes, people, companies, founders (one board listing), founder_sources, connections, templates, variables (the registry of `{{fields}}` used in messages), drafts, follow_ups, captures, agents, settings, llm_usage, activity_log.
- **Access:** row-level security everywhere. Only active members see or change anything. Logged-out visitors and anyone not on the team see nothing.
- **Activity log:** every insert, update and delete is logged by triggers, with who did it (a member or an agent by name), what changed (before and after), and which capture caused it. The log is append-only, and changes can be undone.
- **`apply_capture`:** turns one validated AI result into board changes. It matches existing companies, never erases data, appends notes, keeps private notes separate, creates unknown sources marked "needs check", and refuses the same capture twice.

## Agents
- **11 tools:** `get_overview`, `list_founders`, `get_founder`, `submit_capture`, `update_founder`, `add_connection`, `update_connection`, `list_follow_ups`, `complete_follow_up`, `get_messages`, `recent_activity`.
- **Tokens and limits:** each agent has its own token. The admin can switch an agent between read-only and read-write. Agents can't delete anything, can't see private notes, and never send messages.
- **Documentation:** `AGENTS.md` and `llms.txt` describe how to connect. `robots.txt` blocks crawlers.

## Tested
- 13 unit tests, plus SQL tests on a throwaway Postgres covering access rules, the activity log, undo, capture applying, invites and who-did-what attribution.
- **Live, on the real services:**
  - A synthetic Hinglish recording went through Azure, Gemini, the board and Undo.
  - Every agent tool was called over MCP.
  - The board loaded live data at phone, tablet and laptop sizes in light and dark mode, with no console errors.

## Known gaps (being fixed in `docs/plan-v2.md`)
- The board can't be edited, is founder-first rather than company-first, and isn't laid out for phones.
- There is no drag and drop, and no way to add a source, company or domain.
- Each page has its own header.
- Email sign-in links break behind Vercel's deployment protection.
