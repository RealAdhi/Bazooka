# The Instinct flow, seen from the agent's side

> Superseded on 2026-11-07 by the agent-first flow in `docs/agent-flow.md` (Bazooka no longer runs its own AI). Kept for history.

_Walked through live on 2026-11-06 with a temporary Instinct token against the real board. Everything it created was removed afterwards._

## Setup (once per person)
1. Admin → Team → Agents. Pick the person in the 4-way selector (Piyush, Amogh, Mangala, Adhithya), then **Create token** on their Instinct. The token is shown once.
2. Give Instinct the token and one line: *"You can use Bazooka at `<site>/agents`. Use this token as a Bearer header."* The prompt to paste is on `/agents` (Copy button).

## What the agent sees, step by step

| # | Agent does | Bazooka gives back | Time in the test |
|---|---|---|---|
| 1 | Reads `<site>/agents` (no login) | One page, about 5,000 characters: what Bazooka is, how to connect (MCP `/api/mcp` or REST `/api/agent` + token), what to do, the five questions, the tool list, the rules, and a prompt to paste | — |
| 2 | MCP `initialize` | Server name and **instructions**: call `get_overview` first; send meetings with `submit_capture`; tell Piyush the one-line summary and ask the questions; drafts come from `fill_blanks` then `get_messages`; never invent facts or send messages | instant |
| 3 | `tools/list` | 13 tools with descriptions and input schemas. Read-only tools are marked `readOnlyHint` | instant |
| 4 | `get_overview` | Targets (25 / 50 / 25), progress, buckets, domains and sources with slugs, the six stages | ~2 s |
| 5 | `submit_capture` with Piyush's Hinglish voice note + its five-answer summary + `external_id` | `summary`, what changed (new company in the right domain, a connection, a follow-up with a due date) and `ask_piyush` questions. The private remark went to private notes only | **224 s in the test; now answers within 40 s** (see below) |
| 6 | Same `external_id` again (a retry) | `duplicate: true` with the first result; nothing applied twice | ~2 s |
| 7 | `list_founders {query}` | The company with its slug, domain, bucket, stage, sources and needs | ~2 s |
| 8 | `get_founder {slug}` | Full card: one-liner, stage, raise, met on, where met, needs, connections, follow-ups, stage history. No private notes | ~4 s |
| 9 | `fill_blanks {slug}` | Which empty fields the AI filled and which it left empty (it leaves blanks rather than guess) | 119 s in the test (Gemini hung; now capped at 50 s per try) |
| 10 | `get_messages {slug}` | Six drafts for the top connection, with `[field]` blanks listed per message | ~3 s |
| 11 | `update_connection {status: intro_sent}` | OK; the company moves to "Intros sent" automatically | ~4 s |
| 12 | `update_founder {website, note}` | Which fields changed; the note is appended with today's date | ~3 s |
| 13 | `list_follow_ups` | "Introduce Riya to Dr Mehta, due Monday" | ~1 s |
| 14 | A mistake: `status: "done"` | Error listing the six allowed stages, so the agent can correct itself | <1 s |
| 15 | Tries to delete | "Unknown tool", with the list of tools it can use. Agents can't delete | ~1 s |
| 16 | `recent_activity` | Every change it made, attributed to "Instinct (…)" by name | ~1 s |

## What the test found, and what changed
- **The AI was far too slow for an agent.** One capture took 224 s and fill-in took 119 s. Gemini requests were hanging until the 2-minute timeout and then retrying. Most agents abandon a tool call after about 60 s.
  - Each AI call now gives up after 50 s and moves straight to the next model.
  - `submit_capture` answers within 40 s. If the AI needs longer, it returns `status: "processing"` and a `capture_id`, and keeps working in the background.
  - The new **`get_capture`** tool tells the agent when the capture is done (summary, changes, questions) or failed.
  - The real fix is a faster provider. Add `OPENROUTER_API_KEY` in Vercel and pick OpenRouter in Admin → AI and voice.
- **"Dr Mehta" became "Dr, meet Riya".** Messages now address people as "Dr Mehta" when the name starts with a title.
- **The connection's title held a whole sentence** ("Runs digital health at Example Hospitals"), which the message then repeated. The capture prompt (`capture-v2`) now asks for a job title and an organisation only.

## The flow in one picture

```
Piyush ──voice note──▶ his Instinct
                          │ reads /agents once; MCP initialize gives the rules
                          │ collects the five answers (asks ≤1 follow-up)
                          ▼
              submit_capture(transcript, notes, external_id)
                          │
          ┌───────────────┴────────────────┐
     done in < 40 s                  still processing
          │                                │ "being processed" to Piyush
          │                                ▼
          │                      get_capture(capture_id) ~1 min later
          ▼                                │
   summary + changes + ask_piyush ◀─────────┘
          │
          ▼
 Instinct tells Piyush one line, asks ≤2 questions
          │
          ▼  (later, on request)
 list_founders → update_founder / add_connection / update_connection
 fill_blanks → get_messages → shows drafts (never sends)
          │
          ▼
 Board updates live for all four of you; every change logged under "Instinct (Name)"
```
