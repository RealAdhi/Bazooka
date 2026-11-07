// POST /api/autofill { listing_id } -> the AI fills a company's empty message fields from what Bazooka knows.
import { handler, isUuid } from './_lib/http.js';
import { authenticate } from './_lib/auth.js';
import { requireServerAi } from './_lib/ai-mode.js';
import { HttpError } from './_lib/supabase.js';
import { autofillListing } from './_lib/autofill.js';

export const config = { maxDuration: 120 };

export default handler(async (req, body) => {
  const who = await authenticate(req, { allowAgents: true, scope: 'board:write' });
  await requireServerAi();
  if (!isUuid(body.listing_id)) throw new HttpError(400, 'listing_id is missing.');
  return autofillListing(who, body.listing_id);
});
