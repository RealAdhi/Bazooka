// Vercel routing middleware: runs before static files. An agent that asks the main link for markdown
// (Accept: text/markdown) gets /AGENTS.md instead of the board's HTML. Browsers are not affected.
import { rewrite } from '@vercel/functions/middleware';

export const config = { matcher: ['/', '/index.html'] };

export default function middleware(request) {
  const accept = request.headers.get('accept') || '';
  if (/text\/markdown|text\/x-markdown/i.test(accept) && !/^text\/html/i.test(accept)) {
    return rewrite(new URL('/api/agents-md', request.url));
  }
}
