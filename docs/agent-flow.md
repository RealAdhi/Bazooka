# The agent flow (bazooka-v3)

_Tested live on 2026-11-07 over HTTPS against the deployed site, with a temporary "Grok bot (test run)" token and made-up companies and people. Everything it created was removed afterwards; the activity log keeps its entries._

Bazooka runs no AI of its own. The agent (Piyush's Grok bot, Instinct, anything that can make HTTP requests) does the reading, LinkedIn research and message writing. Bazooka checks what it sends, stores it, and shows it to the team.

## Connecting (once per agent)
1. Admin → Team → Agents → pick the person → **Create token** on their agent.
2. Copy the **Message to give the agent** box underneath (it has the site, `/AGENTS.md` and the token filled in) into the agent. Grok can keep it in memory.
3. The agent reads `/AGENTS.md` once. It holds what Bazooka is, how to connect, what to do in each situation, the rules, the tools, the full `bazooka-v3` format with an example, and the LinkedIn search prompts. It is generated from the code, so it always matches what Bazooka checks.
   - An agent that opens the main link asking for markdown gets AGENTS.md directly. In a browser the main page's HTML starts with a pointer to it.

## What happened in the test

| Step | Agent does | Bazooka answers | Time* |
|---|---|---|---|
| 1 | `GET /` asking for markdown | AGENTS.md (18.5k characters) | 0.35 s |
| 2 | MCP `initialize`, `tools/list` | Short instructions and the 10 tools | 0.33 s each |
| 3 | `get_board` | Every company with slug, needs and people counts, plus domains, sources and stages | 0.39 s |
| 4 | `save_conversation`: transcript, company, founder (LinkedIn), needs (customers, advisor), 3 customers and 1 advisor found on LinkedIn, follow-up, private note, a question | New company, stage "Connections suggested", and a `show_piyush` block to paste into the chat | 0.77 s |
| 5 | Same save again (retry) | The first result; nothing saved twice | 0.68 s |
| 6 | `get_company` | Card with people ids, the six message guides, and search prompts filled in for this company. Private note not included | 0.44 s |
| 7 | `save_people` for "agritech founders in my 1st degree who angel invest", with the new investor need | 2 investors added; Piyush's request stored with them | 0.47 s |
| 8 | `save_message` draft, `update_person` approved, message approved, message sent | The person becomes "intro sent" and the company moves to "Intros sent" by itself | 0.38–0.64 s |
| 9 | `update_person` (they met), `update_company` (where we are, 2 sources, follow-up done) | Stage moves to "Meeting happened" | 0.36–0.45 s |
| 10 | `add_source`, then `remove_source` while in use | Refused with the company using it; then removed with `detach: true` | 0.37–0.43 s |

\* Measured from the cloud test machine, which adds about 0.3 s of network delay of its own. Bazooka itself took about 0.05–0.45 s per call.

### Mistakes the test made on purpose (all refused, nothing saved)
- Old format version: "schema must be one of: bazooka-v3".
- The same company again as new: "already on the board as slug "zz-kheti-labs-test". Send company.slug … to update it".
- 4 investors: "at most 3 per type".
- A researched person without a LinkedIn link, or with a non-LinkedIn link.
- 3 sources: "at most 2".
- An unknown stage: lists the six stages.
- Investors for a company that never asked for them: "only search for what was asked; if Piyush asked for it, also send needs.investor".
- Trying to delete: unknown tool, with the list of tools.
- The old AI endpoint `/api/ingest`: 410, "Bazooka's own AI is switched off … Read /AGENTS.md".

## What Piyush sees in the chat after a save (`show_piyush`)
```
Saved to Bazooka: Zz Kheti Labs (test) (Connections suggested).
Where we are: Met today; Piyush to find buyers and one advisor
Needs: customer: Agri-input companies to bundle the sensor; advisor: Someone who has scaled rural distribution
Potential customers:
- Test Agri One, Head of digital at Example Agri Inputs (1st): Bundles tech with fertiliser sales to FPOs https://www.linkedin.com/in/test-agri-one
- Test Agri Two, CEO at Sample Seeds (1st): Wants farmer data for seed advisory https://www.linkedin.com/in/test-agri-two
- Test Agri Three, VP partnerships at Demo Crop Care (2nd): Runs FPO partnerships across 6 states https://www.linkedin.com/in/test-agri-three
Potential advisors:
- Test Advisor, Founder at Example Rural Retail (1st): Built a 5,000-village distribution network https://www.linkedin.com/in/test-advisor
Questions: Only one advisor fit well; want me to look in 2nd-degree too?
Card: https://<site>/?company=zz-kheti-labs-test
```
The card link opens that company's card on the board.

## The flow in one picture
```
Piyush ── transcript / "find me 3 investors for X" ──▶ Grok bot (or Instinct)
                                                         │ knows Bazooka from its memory + /AGENTS.md
                                                         │ get_board / get_company  (< 0.5 s)
                                                         │ thinks, searches Piyush's LinkedIn with the search prompts
                                                         ▼
                                  save_conversation / save_people  (one transaction, < 1 s)
                                                         │
                         ┌───────────────────────────────┴──────────────────────────┐
                 show_piyush in the chat                               the card on the board
                         │                                                for all four of you
                         ▼
     writes a message from a guide ─▶ Piyush approves ─▶ he sends it ─▶ save_message sent
                                                                       (stage moves by itself)
```
