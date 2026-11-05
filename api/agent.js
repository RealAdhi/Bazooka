// Agent REST API.
//   GET  /api/agent                 -> the tools this token may use (name, description, input schema)
//   POST /api/agent { tool, args }  -> run one tool
// Auth: "Authorization: Bearer bzk_..." (agent token from Admin -> Agents) or a member's session token.
// Same tools as the MCP server (/api/mcp). Docs: /AGENTS.md
import { handler } from './_lib/http.js';
import { authenticate } from './_lib/auth.js';
import { callTool, toolsFor } from './_lib/tools.js';
import { HttpError } from './_lib/supabase.js';

export const config = { maxDuration: 300 };

export default handler(async (req, body) => {
  const who = await authenticate(req, { allowAgents: true });
  if (req.method === 'GET') {
    return { you: who.kind === 'agent' ? { agent: who.agent.name, scopes: who.agent.scopes } : { member: who.member.full_name },
      tools: toolsFor(who).map((t) => ({ name: t.name, description: t.description, scope: t.scope, input_schema: t.input })) };
  }
  if (typeof body.tool !== 'string') throw new HttpError(400, 'Send { "tool": "<name>", "args": { ... } }. GET /api/agent lists the tools.');
  return { tool: body.tool, result: await callTool(who, body.tool, body.args || {}) };
}, { methods: ['GET', 'POST'] });
