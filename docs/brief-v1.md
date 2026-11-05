# Build brief v1 — Bazooka 2.0 · Founder Map (single HTML file)

> **Status: partly superseded (2026-11-05).** This is the original brief the v1 `index.html` was built from. Still valid: purpose, whiteboard content, message templates, visual direction, Future-page content. Superseded by `docs/architecture.md` and `CLAUDE.md`: the one-file rule, "no repo / no hosting / no database", desktop first, no persistence. Now: multiple files where it helps, Vercel + Supabase, phone first, auth, agents.

---

## 0. Skills

| # | Skill | Pull from | Install | Use it for |
|---|---|---|---|---|
| 1 | **frontend-design** (Anthropic, official) | `anthropics/claude-plugins-official` (also in `anthropics/skills`) | `/plugin install frontend-design@claude-plugins-official` · fallback: `/plugin marketplace add anthropics/skills` then install, or `npx skills add anthropics/skills --skill frontend-design` | Design plan, tokens, type, layout. **Primary design skill. Follow its two-pass process.** |
| 2 | **Impeccable** (Paul Bakaus) | `pbakaus/impeccable` | `/plugin marketplace add pbakaus/impeccable` then install from `/plugin` · fallback: `npx skills add pbakaus/impeccable` | After V1: `/impeccable critique`, then `/impeccable audit`, then `/impeccable polish` |
| 3 | **web-design-guidelines** (Vercel Labs) | `vercel-labs/agent-skills` | `npx skills add vercel-labs/agent-skills@web-design-guidelines` | Final accessibility/UX audit pass |
| 4 | **webapp-testing** (Anthropic) | `anthropics/skills` (example-skills) | `/plugin marketplace add anthropics/skills` → install `example-skills` · fallback: copy `skills/webapp-testing/` into `~/.claude/skills/` | Playwright screenshots, clicking every founder, copy buttons, console errors |
| 5 | *(optional)* **ui-ux-pro-max** | `nextlevelbuilder/ui-ux-pro-max-skill` | `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill` → `/plugin install ui-ux-pro-max@ui-ux-pro-max-skill` | Palette/font-pairing lookup only. Must not override frontend-design. |

Rules: frontend-design leads; Impeccable and web-design-guidelines review; don't run two style engines. Use webapp-testing screenshots and look at them before finishing. If a skill can't be installed, say so in one line and continue.

---

## 1. What this is

**Bazooka** is the founder-network engine for Piyush (founder, InMobi group). Piyush meets founders through ecosystem sources (EF, Variance, Antler, SPC, Activate, Local Host, Bloomberg events, etc.). For each founder, Bazooka:
1. puts them in one place, sorted by source and domain,
2. finds the **3 most surgically relevant connections** from Piyush's network (first customers, first investors, advisors),
3. drafts the intro messages,
4. follows up ("how did it go with X?") to capture outcomes.

**Three reasons it exists:**
1. Taste personal superintelligence for real work, not just for bookings and shopping.
2. Stay outside-in: unlock founders through connections (first 3 customers, first investor) so InMobi/Glance benefits later. Not a classical VC game.
3. Personal: help founders become more compelling, conscious founders.

**This month's success metrics:**
- Input: **25 founders**, **50 surgically relevant connections** (≈2 each), mostly autonomous with light approval from Piyush.
- Output: **25 meaningful meetings** from those connections (50% conversion), with feedback captured.
- Quality of connections must not drop as volume rises.

**Audience:** Piyush (laptop and phone, everything at a glance) and his staff (copy and send messages).

**Primary job:** see every founder, where they came from, what bucket they're in, and in one click get six ready-to-send messages.

---

## 2. Hard constraints (v1)

- ~~ONE file `index.html`, inline CSS and JS.~~ *(superseded)* No build step. Must open from `file://` with no console errors.
- CDN only, pinned versions: GSAP 3.x core + DrawSVGPlugin from jsDelivr; Google Fonts with a system fallback stack.
- Hash routing: `#map` (default) and `#future`. Back/forward must work.
- All reads through `const dataSource = { async getAll() { return BAZOOKA_DATA; } };` — later Supabase. UI never touches `BAZOOKA_DATA` directly.
- HTML-escape every data string on render.
- No secrets, no API keys, no network calls besides CDN assets.
- If the CDN fails, the page still renders fully without animation.
- ~~Desktop first (1440px)~~ *(superseded: phone first)*, solid at 1024px, usable on a phone.

---

## 3. Source content: the whiteboard

Unclear handwriting is marked **(verify)** and shows a "needs check" marker in the UI.

### Sources
| Source | Note on board |
|---|---|
| EF (Entrepreneur First) | circled **5** |
| Variance | circled **5** |
| Local Host | "??" — tentative |
| Activate | |
| Antler | grouped with SPC |
| SPC (South Park Commons) | grouped with Antler |
| Bloomberg (event) | PopVax's source |
| Miraqules (verify) | Sabir's source |
| Source TBD | founders whose source isn't on the board |

### Buckets and lanes

**Ecosystem — add value** (no direct InMobi link needed)
- **Bio-Science:** PopVax — Bloomberg (personalised cancer vaccines; Piyush met them in person) · Mandrake — Antler · Locksmith Bio — Activate / EF (two lines) · Alpha-Grid — Variance · Sabir — Miraqules (verify)
- **AI-native:** Tarini — Detective AI (verify; board reads "Detectify"; wants Piyush's reference) · Robocare — Ayush (verify) · Amit Sharma (faint, verify) · Kunal (verify) — Keshav (faint, verify) · *open slot*
- **Space:** 3 open slots (space founders met at an Outside-In session; names to come)
- **Defence:** open lane

**Moonshot #1 — InMobi / Glance:** Prava ✓ (InMobi became first customer) · Aina · Vinat (?) verify · Turiam ✓ (InMobi first customer) · *open slot*

**Unlock / Learning:** Code Yogi · Lamehouse (verify, could be "Lanehouse") · MUZO (verify) · *open slot*

Open slots render as quiet "Add founder" slots showing the gap to 25.

---

## 4. Page 1 — `#map`

- **Top bar:** "Bazooka" wordmark, tab switch "Map / Future plans", month label (November 2026).
- **Progress strip:** Founders (n/25), Connections (n/50), Meetings (n/25), Follow-ups pending (n). Computed from data, shown as progress toward target.
- **Filter row:** source, bucket, domain, status, search (⌘K / Ctrl+K).
- **Map canvas:** Sources rail left; three buckets as regions holding domain lanes as columns.
- **Connectors:** SVG layer behind cards from each source to each founder; computed from `getBoundingClientRect`, recomputed on resize/filter (debounced ~100ms).

**Founder card:** name, company/one-liner, source chip, status marker. Status: `new` → `connections_suggested` → `intros_sent` → `meeting_happened` → `feedback_captured`. Prava and Turiam carry a "customer" tick. "Needs check" marker when any field is in `verify`.

**Interactions:** hover founder → highlight its source line(s) and lane, dim the rest, tooltip with needs and bucket reason. Click / Enter → overlay. Hover source → highlight its founders, expected vs actual.

**Founder overlay:**
- Header: name, company, source, met on, domain, bucket, stage (+ needs-check markers).
- Connection picker: segmented control with 3 suggested connections (name, type, one-line reason). Picking one re-fills all six messages at once.
- Editable fields row: inputs for every placeholder; typing updates all six live (memory only).
- Six message cards (2×3, one column on mobile): title, channel, filled message, unfilled fields as highlighted blanks like `[connection_org]`. Buttons: **Copy** (toast "Copied, 2 blanks left" if blanks), **Open in WhatsApp** (`https://wa.me/?text=<encoded>`), **Open email** (`mailto:?subject=…&body=…`).
- Status timeline: met → suggested → sent → meeting → feedback, with dates.
- Close with Esc, close button, backdrop. Focus trapped; focus returns to the card.

**Copy:** `navigator.clipboard.writeText` with hidden-textarea fallback; button shows "Copied" with a check for ~1.2s.

---

## 5. The six message templates

Placeholder syntax `{{field}}` or `{{field|fallback}}`. Regex: `/\{\{(\w+)(?:\|([^}]*))?\}\}/g`. Missing values: highlighted blanks in preview, `[field]` in copied text.

Piyush's voice: first person, conversational, short. Group intros and emails open with "Guys," and are signed "Piyush". Numbered points only when there's more than one point.

1. **Intro: first customer** (WhatsApp group, default)
   > Guys, quick intro.
   > {{connection_first_name}}, meet {{founder_first_name}}. They're building {{company}}: {{one_liner}}. We met at {{source_event}}.
   > {{founder_first_name}}, {{connection_first_name}} is {{connection_title}} at {{connection_org}}. Given their work on {{connection_relevance}}, I think {{company}} could be really useful there, maybe as an early customer or design partner.
   > I'll let you two take it from here.
   > Piyush

2. **Intro: investor** (WhatsApp group or email)
   > Guys, connecting you two.
   > {{connection_first_name}}, {{founder_first_name}} is building {{company}}: {{one_liner}}. They're at {{stage}}{{raise_clause|}}. What stood out to me: {{founder_highlight}}.
   > I think it fits your focus on {{connection_thesis}}.
   > {{founder_first_name}}, {{connection_first_name}} is {{connection_title}} at {{connection_org}}.
   > Over to you both.
   > Piyush

3. **Intro: advisor / expert**
   > Guys, an intro I've been meaning to make.
   > {{connection_first_name}}, {{founder_first_name}} at {{company}} is working on {{one_liner}} and could use a sharp view on {{advice_topic}}. Nobody I know understands this better than you.
   > {{founder_first_name}}, {{connection_first_name}} is {{connection_title}} at {{connection_org}}.
   > Piyush

4. **Follow-up: how did it go?** (to the founder, WhatsApp)
   > Hi {{founder_first_name}}, how did it go with {{connection_first_name}}? Did anything useful come out of it? Even a one-line reply helps me make better intros next time.

5. **Keep warm / offer help**
   > Hi {{founder_first_name}}, was thinking about {{company}} after we met at {{source_event}}. Saw {{recent_signal|the progress you're making}}, great to see.
   > If something is blocking you right now, tell me and I'll see who can help.

6. **Deeper strategy conversation**
   > Hi {{founder_first_name}}, I kept coming back to {{strategy_topic}} after our chat. There may be a real overlap with what we're doing at {{inmobi_unit|InMobi and Glance}}.
   > Up for a 30-minute deeper conversation in the next couple of weeks? {{scheduling_note|Happy to work around your time.}}
   > Piyush

Fields:
- Founder: `founder_first_name, company, one_liner, stage, raise_clause, source_event, founder_highlight, recent_signal, strategy_topic, advice_topic`
- Connection: `connection_first_name, connection_title, connection_org, connection_relevance, connection_thesis`
- Meta: `inmobi_unit, scheduling_note`

---

## 6. Visual direction

Follow frontend-design: write the plan (4–6 named hex colours, type roles, ASCII wireframes, principles), review against this brief, revise anything generic, then build.

- **"The whiteboard, made precise."** Cool, clean board surface (not cream); marker inks for the three buckets (blue, green, red) with black ink for structure.
- **Signature moment:** on load, connector lines draw from sources to founders like marker strokes (GSAP DrawSVG), lane by lane. Then everything is still.
- Dark theme (the board at night) with a toggle; follow system preference by default.
- Avoid: cream + terracotta, near-black + single acid accent, identical rounded SaaS cards with grey shadows, ALL-CAPS eyebrows, middle-dot meta strings, decorative mono labels, "→" on buttons. Numbered markers only for real sequences.
- Copy: plain, sentence case, active verbs. Empty slots invite action. Errors say what happened and what to do.

**Motion:** load = regions fade in quickly, then lines draw (~600ms, ease-out, small stagger), no per-card fade-ups. Hover highlight ~150–200ms. Overlay: backdrop ~180ms; panel scale 0.96→1 + 8px rise ~240ms; close ~160ms; message cards arrive together. Connection switch: text cross-fades ~150ms. Copy: icon swap and check. Reduced motion: no line drawing, opacity fades under 120ms.

---

## 7. Page 2 — `#future`

### 7.1 Vision
Piyush records a conversation, or voice-types a short note using the template below, into **Grok bot** (his chief-of-staff agent), **Notion AI**, or **Instinct**. Bazooka routes the information and returns the 3 most relevant connections. Notion Enterprise is the central context engine; the dashboard is the window into it. Include the three whys and the success metrics.

### 7.2 Routing pipeline (animated SVG flow, numbered steps, click to expand)
1. **Capture.** Recorded meeting (Notion AI Meeting Notes or Grok voice) or a voice-typed note in any of the three interfaces.
2. **Normalize to Notion.** Grok writes via its Notion connector; Notion AI natively; Instinct has no API, so forward the note to a Notion email-to-page address or paste into the Grok bot. Notion Founders database = single source of truth.
3. **Enrich and classify.** A Notion Custom Agent on new page fills bucket, domain, stage, needs.
4. **Rank connections.** Query People database (closeness × stature × tag match), propose top 3 with reasons. Score `0.5 × fit + 0.3 × closeness + 0.2 × stature`.
5. **Draft.** Fill the six templates. WhatsApp group default, email alternative.
6. **Light approval.** One daily digest to Piyush: "5 founders, 10 intros ready. Reply 'ok all', 'skip 3', or edit." Never more than one approval touch a day.
7. **Send.** Phase 1: `wa.me` / `mailto:` links from the dashboard (his real identity). Phase 2: official business number via WhatsApp Groups API, or email from a non-InMobi Google Workspace.
8. **Follow-up.** Scheduled agent 5 days after the intro drafts "how did it go with X?"; replies logged, status updates.

### 7.3 Tools today
| Tool | Role | Status | What to say |
|---|---|---|---|
| **Notion Enterprise** | Hosted context engine | Ready | Hosted MCP server, Custom Agents on triggers and schedules (credits), 150+ MCP connections, MCP governance on Enterprise. |
| **Grok Enterprise** | Chief-of-staff reasoning layer | Admin setup needed | Notion, Gmail, Outlook connectors need admin provisioning. API supports remote MCP tools, so a Grok agent can call Notion MCP and later a Supabase-backed custom MCP. |
| **Instinct** | Capture only | Capture only | Personal-use only, no API, can act without checking, has had WhatsApp outages and bans, connector list undocumented. Don't let it send intros on its own. |
| **InMobi Outlook** | Email channel | Blocked by default | Needs IT admin consent for mailbox access. Either consent for one vetted app, or send from a separate non-corporate account. |

Sources:
- Notion: https://www.notion.com/releases/2026-10-13 · https://www.notion.com/help/mcp-connections-for-custom-agents
- Grok: https://docs.x.ai/grok/connectors · https://docs.x.ai/developers/tools/remote-mcp
- Instinct: https://cellcog.ai/blog/what-is-instinct-ai/ · https://instinct.com/terms
- Outlook: https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies
- WhatsApp Groups API: https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/reference

### 7.4 Voice-note template
> Bazooka note. Founder: [full name], company [name], [one line on what they do]. Met via [source or event], on [date]. Domain: [bio-science, AI-native, space, defence, other]. Stage: [idea, pre-seed, seed, A], raising [amount] if any. Bucket: [Moonshot one, InMobi or Glance relevance and why; or ecosystem, just add value; or unlock and learning]. What they need: [first customers, investors, advisors, hires], specifically [detail]. Who I think can help: [names], because [reason]. I committed to: [what I promised, by when]. Conviction: [1 to 5]. Anything private: [say "private" and it stays out of every intro].

### 7.5 Parser system prompt
> You are Bazooka, Piyush's founder-network chief of staff. From the note or transcript, extract JSON with: founder full_name, company, one_liner, source, source_event, met_on, domain, stage, raise, bucket ("moonshot_inmobi_glance" if relevant to InMobi/Glance business or the agentic-AI next S-curve; "unlock_learning" if the main value is helping the founder grow; otherwise "ecosystem") with bucket_reason, needs[], suggested_helpers[] with reasons, commitments[] with due dates, conviction 1–5, and private_notes. Never put private_notes in any outbound draft. If a field is missing, set it to null and list it under "ask_piyush" (at most 2 questions). Then rank the top 3 connections from the People database by fit to needs, closeness and stature, with one sentence of reasoning each. Draft intros using the message templates. Do not send anything. Queue the drafts for Piyush's daily approval digest.

### 7.6 Roadmap
- **Now:** one HTML file, hardcoded data.
- **By the 6th:** V1 with real data, Vercel from a private GitHub repo, one-tap WhatsApp/email, Notion Founders and People databases with one Custom Agent.
- **By the 9th:** Supabase behind login, Notion → Supabase sync, follow-up scheduler, daily digest, live funnel counters.
- **Later:** automated WhatsApp via official number, Outlook automation after IT approval, Grok bot as main interface.

### 7.7 Data model preview
sources, founders, people, connections, message templates, follow-ups — one line each.

---

## 8. Data shape (v1)

```js
const BAZOOKA_DATA = {
  meta: { month: "November 2026", targets: { founders: 25, connections: 50, meetings: 25 } },
  sources: [ { id, name, full_name?, expected?, tentative?, group?, verify? } ],
  buckets: [ { id, name, lanes: [laneId] } ],
  lanes:   [ { id, name, slots } ],
  founders: [ { id, first_name, company, one_liner, lane, source_ids, source_event, met_on, stage,
                raise_clause, needs, founder_highlight, recent_signal, strategy_topic, advice_topic,
                whatsapp, email, status, customer_tick, verify: [], connections: [] } ],
  people: [], templates: [ { key, title, channel, subject?, body } ]
};
```

Rules: only whiteboard names; unknown fields `null`; `verify` lists fields to check; connections are fake "Connection A/B/C" (customer, investor, advisor, `org: null`); Prava and Turiam `customer_tick: true`, `status: "meeting_happened"`; Locksmith Bio `source_ids: ["activate", "ef"]`.

---

## 9. Acceptance checklist (v1)

- Zero console errors from `file://`; `#map` and `#future` with back/forward.
- Every whiteboard name in the right lane with the right source line(s); open slots as "Add founder".
- "Needs check" markers on every verify field; progress strip computed from data.
- Filters and search update the map and re-route lines.
- Overlay: exactly six messages filled at once; switching connection re-fills all six; editing a field updates all six.
- Copy works (incl. `file://` fallback) and flags blanks; WhatsApp and email links correctly encoded.
- Future page complete; keyboard and focus trap; contrast ≥ 4.5:1 both themes; reduced motion; both themes intentional.
- Changing `dataSource.getAll()` re-renders everything.
- Screenshots at 1440, 1024, 390 reviewed and fixed; Impeccable critique → polish → web-design-guidelines audit.

## 10. Out of scope for v1
No repo, Vercel, Supabase, auth, persistence, real contacts or real connection names. *(All now in scope — see `docs/architecture.md`.)*
