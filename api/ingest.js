// POST /api/ingest
//   Member (website):  { capture_id, notes_text? }         -> process a recorded capture
//   Agent (bzk_ token): { transcript, notes?, external_id? } -> create a capture and process it
// Same pipeline for both: board context -> LLM (provider order from settings) -> validate -> apply_capture.
import { handler, isUuid } from './_lib/http.js';
import { authenticate } from './_lib/auth.js';
import { db, must, HttpError } from './_lib/supabase.js';
import { validateCapture } from './_lib/capture-schema.js';
import { buildCapturePrompt, buildCaptureUserMessage, buildRepairMessage, CAPTURE_PROMPT_VERSION } from './_lib/prompts.js';
import { complete, resolveProviders } from './_lib/llm.js';

export const config = { maxDuration: 300 };

const CHANNEL_BY_KIND = { grok: 'grok', instinct: 'instinct', notion: 'notion' };
const MAX_TEXT = 200000;   // ~ 3 hours of speech; protects the LLM call

export default handler(async (req, body) => {
  const who = await authenticate(req, { allowAgents: true, scope: 'capture:write' });
  const sb = db(who.actor);

  // 1. Get or create the capture
  let cap;
  if (who.kind === 'member') {
    if (!isUuid(body.capture_id)) throw new HttpError(400, 'capture_id is missing.');
    cap = must(await sb.from('captures').select('*').eq('id', body.capture_id).maybeSingle(), 'Loading capture');
    if (!cap) throw new HttpError(404, 'That capture does not exist.');
    if (typeof body.notes_text === 'string') {
      cap = must(await sb.from('captures').update({ notes_text: body.notes_text.slice(0, MAX_TEXT) }).eq('id', cap.id).select('*').single(), 'Saving notes');
    }
  } else {
    const transcript = typeof body.transcript === 'string' ? body.transcript.slice(0, MAX_TEXT) : '';
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, MAX_TEXT) : '';
    if (!transcript.trim() && !notes.trim()) throw new HttpError(400, 'Send a transcript or notes.');
    const external_id = typeof body.external_id === 'string' ? body.external_id.slice(0, 200) : null;
    if (external_id) {
      const prior = must(await sb.from('captures').select('id, status, result, llm_output').eq('agent_id', who.agent.id).eq('external_id', external_id).maybeSingle(), 'Checking duplicates');
      if (prior?.status === 'processed') return { capture_id: prior.id, duplicate: true, summary: prior.llm_output?.summary, result: prior.result };
      if (prior) cap = must(await sb.from('captures').select('*').eq('id', prior.id).single(), 'Loading capture');
    }
    cap ||= must(await sb.from('captures').insert({
      channel: CHANNEL_BY_KIND[who.agent.kind] || 'api', status: 'transcribed', agent_id: who.agent.id,
      external_id, transcript, notes_text: notes,
    }).select('*').single(), 'Creating capture');
  }
  if (cap.status === 'processed') return { capture_id: cap.id, duplicate: true, summary: cap.llm_output?.summary, result: cap.result };
  if (!cap.transcript?.trim() && !cap.notes_text?.trim()) throw new HttpError(400, 'This capture has no transcript or notes yet.');

  must(await sb.from('captures').update({ status: 'processing', error: null }).eq('id', cap.id), 'Updating capture');

  try {
    // 2. Board context so the LLM matches instead of duplicating
    const [lanes, sources, founders, llmRow] = await Promise.all([
      sb.from('lanes').select('slug, name, bucket:buckets(slug, name)').is('archived_at', null).order('position'),
      sb.from('sources').select('slug, name, full_name').is('archived_at', null).order('position'),
      sb.from('founders').select('slug, status, lane:lanes(slug), person:people(full_name, first_name), company:companies(name)').is('archived_at', null),
      sb.from('settings').select('value').eq('key', 'llm').maybeSingle(),
    ]);
    const board = {
      lanes: must(lanes, 'Loading lanes').map((l) => ({ slug: l.slug, name: l.name, bucket_name: l.bucket?.name })),
      sources: must(sources, 'Loading sources'),
      founders: must(founders, 'Loading founders').map((f) => ({
        slug: f.slug, status: f.status, lane: f.lane?.slug,
        name: f.person?.full_name || f.person?.first_name, company: f.company?.name,
      })),
    };
    const llm = must(llmRow, 'Loading settings')?.value || {};
    const providers = resolveProviders(llm);
    if (!providers.length) throw new HttpError(503, 'No LLM is set up. Ask the admin to add a Gemini, Claude or Grok key.');

    const authorName = who.kind === 'member' ? who.member.full_name : who.agent.name;
    const system = buildCapturePrompt({ board, nowIso: new Date().toISOString().slice(0, 10), channel: cap.channel, authorName });
    const user = buildCaptureUserMessage({ transcript: cap.transcript, notes: cap.notes_text });
    const check = { laneSlugs: board.lanes.map((l) => l.slug), sourceSlugs: board.sources.map((s) => s.slug), founderSlugs: board.founders.map((f) => f.slug) };

    // 3. Ask providers in order; each gets one repair attempt if its JSON fails validation
    let parsed, used, lastError;
    for (const provider of providers) {
      const model = llm.models?.[provider];
      const messages = [{ role: 'user', content: user }];
      for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
        try {
          const r = await complete(provider, { model, system, messages });
          const v = validateCapture(r.text, check);
          await sb.from('llm_usage').insert({ capture_id: cap.id, provider, model, purpose: `${CAPTURE_PROMPT_VERSION}${attempt ? ' repair' : ''}`,
            input_tokens: r.usage.input ?? null, output_tokens: r.usage.output ?? null, ok: v.ok });
          if (v.ok) { parsed = v.value; used = { provider, model }; break; }
          lastError = `${provider}: ${v.errors.slice(0, 3).join('; ')}`;
          messages.push({ role: 'assistant', content: r.text.slice(0, 20000) }, { role: 'user', content: buildRepairMessage(v.errors) });
        } catch (err) {
          lastError = `${provider}: ${err.message}`;
          await sb.from('llm_usage').insert({ capture_id: cap.id, provider, model: model || 'unknown', purpose: CAPTURE_PROMPT_VERSION, ok: false });
          break;   // network / API error: move to the next provider
        }
      }
      if (parsed) break;
    }
    if (!parsed) throw new HttpError(502, `None of the AI providers returned a usable result. Last error: ${lastError}`);

    // 4. Apply in one transaction
    must(await sb.from('captures').update({ llm_provider: used.provider, llm_model: used.model }).eq('id', cap.id), 'Saving provider');
    const result = must(await sb.rpc('apply_capture', { p_capture_id: cap.id, p_payload: parsed }), 'Applying capture');
    return { capture_id: cap.id, summary: parsed.summary, ask_piyush: parsed.ask_piyush, result, provider: used.provider };
  } catch (err) {
    await sb.from('captures').update({ status: 'failed', error: err.message.slice(0, 1000) }).eq('id', cap.id);
    throw err;
  }
});
