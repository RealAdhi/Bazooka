# Bazooka for AI agents

Bazooka is Piyush's private founder-network board (InMobi group). Agents (Piyush's Grok bot, Instinct, a Notion AI custom agent, Claude, others) can read the board, record meetings, and update founders. Everything an agent does is logged under its name and can be undone by a person.

- **Site:** `https://bazooka-adhithyasriram-sureshs-projects.vercel.app` (below: `<BAZOOKA_URL>`)
- **MCP server:** `<BAZOOKA_URL>/api/mcp` (Streamable HTTP, stateless JSON; no SSE)
- **REST:** `GET <BAZOOKA_URL>/api/agent` lists your tools; `POST <BAZOOKA_URL>/api/agent` with `{ "tool": "...", "args": { ... } }` runs one
- **Auth:** header `Authorization: Bearer bzk_...`. Tokens are created by the Bazooka admin in **Admin → Agents** and shown once. Without a valid token every call returns 401.

## 1. Connect

**MCP clients (Grok, Notion custom agents, Claude, Cursor…):** add a remote MCP server with URL `<BAZOOKA_URL>/api/mcp` and the header `Authorization: Bearer <token>`. The server sends its own instructions on `initialize`.

**Anything that can make HTTP requests:**

```bash
curl -s <BAZOOKA_URL>/api/agent -H "Authorization: Bearer $BAZOOKA_TOKEN"            # list tools

curl -s <BAZOOKA_URL>/api/agent -H "Authorization: Bearer $BAZOOKA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool":"submit_capture","args":{"transcript":"...","notes":"...","external_id":"msg-123"}}'
```

Older integrations can still `POST <BAZOOKA_URL>/api/ingest` with `{ transcript, notes, external_id }`; it is the same as `submit_capture`.

## 2. Tools

| Tool | Scope | What it does |
|---|---|---|
| `get_overview` | read | Targets and progress, buckets, lanes, sources (with slugs), statuses. **Call first.** |
| `list_founders` | read | Filter by `query`, `lane`, `bucket`, `source`, `status`, `needs_check`. Returns slugs. |
| `get_founder` | read | One founder: details, 3 connections, follow-ups, status timeline. Never private notes. |
| `get_messages` | read | The six ready-to-send drafts for a founder + connection. Blanks show as `[field]`. |
| `list_follow_ups` | read | Open promises and next steps. |
| `recent_activity` | read | What changed lately and who changed it. |
| `submit_capture` | capture | A transcript and/or notes about a meeting. Bazooka's intake AI updates the board and returns `summary`, `result`, `ask_piyush`. |
| `update_founder` | write | Change specific fields (status, lane, stage, needs, contact, company…). `note` is appended. `checked` clears "needs check". |
| `add_connection` | write | Suggest someone from Piyush's network for a founder (customer, investor, advisor). |
| `update_connection` | write | Record intro sent / meeting happened / declined. Founder status follows. |
| `complete_follow_up` | write | Mark a follow-up done with the outcome. |

Each tool's full input schema comes back from `tools/list` (MCP) or `GET /api/agent`.

## 3. Instructions to paste into your agent

> You are connected to Bazooka, Piyush's founder-network board, as a tool. Whenever Piyush tells you about a founder he met, or gives an update on one, collect these five answers from what he says (ask at most one short follow-up if the first is missing):
>
> 1. Who did you meet? (name, company, what they're building)
> 2. Where and how? (source or event, and when)
> 3. What do they need? (customers, investors, advisors, hires, and specifically what)
> 4. Who can help, and why? (people in Piyush's network)
> 5. What did you promise, and what's next? (and anything he says is private)
>
> Then call `submit_capture` with his words as `transcript`, your summary of the five answers as `notes`, and a unique `external_id`. Tell Piyush the `summary` in one line and ask him any `ask_piyush` questions.
>
> For specific requests ("move PopVax to Moonshot", "mark the intro to Ravi as sent", "what's pending?") use `list_founders` to find the slug, then `update_founder`, `update_connection`, `list_follow_ups` or `complete_follow_up`. Use `get_messages` when he wants a draft; show it to him, never send it.
>
> Rules: record only what Piyush said; never invent people, numbers or contact details. Anything he calls private goes in `notes` marked "private" and nowhere else. Never send messages, emails or intros yourself. If Bazooka returns an error, tell Piyush in one line what failed and keep his note so he can retry.

## 4. Rules Bazooka enforces

- Agents can't delete anything, can't see private notes, and can't change members, settings or tokens.
- Unknown fields, wrong types and bad statuses are rejected with a message saying what to fix.
- `submit_capture` with the same `external_id` twice returns the first result instead of applying it again.
- Every change is in the activity log with the agent's name; the admin can undo any of them.
- Bazooka never sends messages to people. Drafts are for a human to send.

## 5. Not for crawlers

`robots.txt` blocks all crawling. Nothing here is for indexing or training.
