// POST /api/ingest
//   Member (website):  { capture_id, transcript?, notes_text? } -> process a capture (transcript = corrected text)
//   Agent (bzk_ token): { transcript, notes?, external_id? }   -> create a capture and process it
// The pipeline itself lives in _lib/capture.js.
import { handler } from './_lib/http.js';
import { authenticate } from './_lib/auth.js';
import { requireServerAi } from './_lib/ai-mode.js';
import { runIngest } from './_lib/capture.js';

export const config = { maxDuration: 300 };

export default handler(async (req, body) => {
  const who = await authenticate(req, { allowAgents: true, scope: 'capture:write' });
  await requireServerAi();
  return runIngest(who, body);
});
