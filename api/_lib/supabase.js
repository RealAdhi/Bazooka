// Server-side Supabase client (service role). Never imported by browser code.
import { createClient } from '@supabase/supabase-js';

let admin;
// actor: 'agent:<slug>' or 'member:<uuid>' so database triggers attribute service-role writes correctly.
export function db(actor) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, 'The server is missing its Supabase settings. Ask the admin to add them in Vercel.');
  if (!actor) {
    admin ||= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return admin;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-bazooka-actor': actor } },
  });
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function must({ data, error }, what) {
  if (error) throw new HttpError(500, `${what}: ${error.message}`);
  return data;
}
