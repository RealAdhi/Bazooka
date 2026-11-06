# Plan v2: simplify and make everything editable

_2026-11-06. Built in this order. Each line names the file it changes._

## 1. Logins (no emails at all)
- **Supabase (done from a session, not in code):** create 4 users with the shared team password (set in Supabase only, never in the repo): piyush@glance.com, amogh.krishnan@glance.com, mangala.dilip@glance.com, adhithya.sriram@glance.com. Change the existing admin's email from `adhithya.sriram@inmobi.com` to `adhithya.sriram@glance.com`. Adhithya stays admin.
- **`login.html`:** email + password only. Remove "Email me a sign-in link", the "check your email" view and the set-password view.
- **`app/data.js`:** remove `sendLink` and `setPassword`.
- **`api/admin.js`:** replace `invite`/`resend_invite` with `add_member { full_name, email, password, role }`. It creates the Supabase user directly (no email) and records who added them. Add `set_password`.
- **`supabase/migrations/*_invites`:** unchanged. The invite list becomes the record of who was added and by whom.

## 2. One header on every page
- **New `app/header.js`** (shared by 4 pages):
  - Logo: "Bazooka" plus a red handwritten "2.0".
  - A segmented toggle: Capture | Board, plus Admin for admins.
  - Rightmost, for admins only: a settings button with "Admin" and "Sign out". Everyone else gets a plain "Sign out".
- **`app/tokens.css`:** dark theme is the only theme. Remove the light/dark toggle, the month label and the gear button everywhere.
- **`index.html`, `capture.html`, `admin.html`:** use the shared header. `login.html` shows the same logo.

## 3. Admin page (`admin.html`)
- **Tabs:** Team, Activity, AI and voice.
- **Team:**
  - Remove "Invite someone". Add "Add a person" (name, email, password, role); it creates the login directly.
  - Members and Invites side by side; Invites gets an "Invited by" column.
  - Agents move here, below them.
- **Activity:**
  - One compact line per entry; details on tap.
  - 50 entries per page, with previous/next arrows and a page number.
  - Usage in its own section underneath.
- **AI and voice:** unchanged.

## 4. Database (`supabase/migrations/20261106000800_board_v2.sql`)
- **New status `completed`** after `feedback_captured`, giving six stages, the same for every company.
- **`founder_team`:** a company can have several founders (person, role, order). Existing founders are copied in.
- **Connection labels:** placeholder labels become "Potential customer", "Potential investor" and "Potential advisor".
- **Agent and capture contract:** knows the `completed` status. Agents still can't delete anything.

## 5. Board (`index.html`, rebuilt; `app/data.js` gets the writes)
- **Order on the page:**
  1. Header.
  2. The title "Click a company to get 6 ready-to-send messages".
  3. Filters, with a legend explaining the six stages beside them.
  4. The board.
  5. "Founder map" text and progress numbers, moved below the board.
- **Removed:** the search box, the footer, and the Future plans tab (its content stays in `docs/brief-v1.md`).
- **Company first:** cards show the company name as the title and "with Ayush, Neha" underneath.
- **Sources become their own section** like the buckets:
  - Drag to reorder.
  - Sort by manual order, most companies, or most connections left.
  - Sources with no companies sink to the bottom with a delete button.
  - "Add source" at the bottom.
- **Every lane:**
  - Drag to reorder companies within the lane (not between lanes).
  - "Add company" at the bottom.
  - Domain titles can be renamed, and bucket titles too.
- **Progress dots:** six dots, one per stage. When a company reaches Completed they all turn green and a delete button replaces them.
- **Company panel ("ID card"):**
  - Every field is editable in place: company, one-liner, website, founders, sources, domain (which sets the bucket), stage, raise, met on, where met, needs, what stood out, recent signal, advice topic, strategy topic, conviction, notes.
  - A clickable status bar for the six stages; Delete appears at Completed.
  - Connections show as Potential customer / investor / advisor: pick one, then see its details.
  - The six messages sit in a collapsed section. They are mainly for agents (`get_messages`).
  - A "Fill the blanks with AI" button.
- **Logging:** every change goes through `app/data.js` and is logged and undoable by the database.
- **Layout:** phone first; on a phone the buckets stack and the source lines hide.

## 6. AI fills the blanks
- **New `api/autofill.js` + `api/_lib/autofill.js`:** given a company, the AI fills only empty fields (what stood out, recent signal, advice and strategy topics, and connection relevance and thesis). It uses what Bazooka already has: one-liner, needs, notes, and the transcripts of captures that touched the company. It never invents names, numbers or contact details.
- **Also an agent tool:** `fill_blanks`.

## 7. Agents get a front door
- **New `agents.html`** at `/agents`, no login needed: what Bazooka is, how to connect (MCP / REST plus token), the tools, and the instructions to paste. `AGENTS.md` and `llms.txt` point to it.
- **Flow:** the admin creates a token for Instinct and tells Instinct "go to `<site>/agents`". Everything else is explained there.

## 8. Check
- Run the local SQL and unit tests and the live agent test.
- Screenshot every page at 390, 1024 and 1440 with real data.
- Update `CLAUDE.md` and `docs/summary.md`.
