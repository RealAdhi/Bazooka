// GET /api/config -> the public settings the browser needs (anon key is public by design; RLS protects data).
import { handler } from './_lib/http.js';

export default handler(async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return { configured: false };
  return { configured: true, supabaseUrl, supabaseAnonKey };
}, { methods: ['GET'] });
