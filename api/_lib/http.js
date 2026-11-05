// Tiny helpers for Vercel Node functions.
import { HttpError } from './supabase.js';

export function handler(fn, { methods = ['POST'] } = {}) {
  return async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-robots-tag', 'noindex');
    if (!methods.includes(req.method)) {
      res.setHeader('allow', methods.join(', '));
      return res.status(405).json({ error: `Use ${methods.join(' or ')}.` });
    }
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const out = await fn(req, body, res);
      if (!res.headersSent) res.status(200).json(out ?? { ok: true });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(err);
      res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? 'Something went wrong on the server. Try again; if it keeps happening, check the logs.' : err.message });
    }
  };
}

export const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
