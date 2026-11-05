# Prompts

| Prompt | Lives in | Used by |
|---|---|---|
| Capture (intake clerk) | `api/_lib/prompts.js` → `buildCapturePrompt` | `api/ingest.js`, for every capture from any interface |
| Capture output contract | `api/_lib/capture-schema.js` → `CAPTURE_JSON_SCHEMA` | Sent to the LLM, and enforced before anything is written |
| Agent inbound contract | `docs/prompts/agent-inbound.md` | Pasted into Piyush's Grok bot, Instinct, Notion AI custom agent |

## How a capture is processed
1. The prompt is built fresh each time from the live board: lanes, sources, and every founder already tracked (so the LLM matches instead of duplicating).
2. Providers are tried in the order in `settings.llm.order` (default: Notion AI → Grok → admin's choice). Notion is skipped until it has a callable API.
3. Each provider gets one repair attempt: if its JSON fails validation, the errors are sent back and it tries once more.
4. The validated JSON goes to `apply_capture` (Postgres), which applies everything in one transaction and logs every change with the capture's author.

## Design choices in the capture prompt
- **null means "no change".** The LLM can never erase data, only add or update.
- **Private stays private.** Anything called private goes only to `private_notes`, which no template reads.
- **Uncertain names are flagged, not guessed silently.** They go into `uncertain_fields` and show as "needs check".
- **Transcripts are data.** A rule tells the model to ignore instructions inside the transcript (prompt injection).
- **Message-ready fragments.** `founder_highlight` etc. are written to drop straight into Piyush's templates.

Bump `CAPTURE_PROMPT_VERSION` whenever the prompt changes; it is recorded on every LLM call in `llm_usage`.
