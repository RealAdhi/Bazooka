// Bazooka MCP server (Model Context Protocol, Streamable HTTP transport, stateless JSON responses).
// URL: https://<site>/api/mcp   Auth header: "Authorization: Bearer bzk_..." (Admin -> Agents)
// Exposes the same tools as /api/agent. No server-sent events; every request gets one JSON reply.
import { authenticate } from './_lib/auth.js';
import { callTool, toolsFor } from './_lib/tools.js';
import { HttpError } from './_lib/supabase.js';

export const config = { maxDuration: 300 };

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = `Bazooka is Piyush's founder tracker (InMobi group): every company he meets, its founders, the conversations, the people from his network who can help, and the messages sent. You do all the thinking, LinkedIn research and message writing; Bazooka only stores and shows the results. Read /AGENTS.md on this site once: it has the full bazooka-v3 format and the rules.
- get_board first (slugs, domains, sources). get_company before working on one company: it has the needs, people, conversations, the six message guides and the LinkedIn search prompts filled in for that company.
- After a meeting: research the people asked for (only the types the conversation asked for, up to 3 each, never pad), then save everything with save_conversation in one call. Show Piyush the show_piyush block it returns.
- "Find me investors for X": get_company, search LinkedIn with Piyush's own words, save_people with his request. Show him show_piyush.
- Messages: write from a guide, show Piyush, save_message as draft; approved when he says yes; sent when it went out.
- Never invent people, links or facts. Private things go in private_note only.`;

const rpc = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handle(msg, who) {
  const { id, method, params = {} } = msg || {};
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return rpcErr(id, -32600, 'Invalid JSON-RPC request');
  const isNotification = id === undefined;
  switch (method) {
    case 'initialize':
      return rpc(id, {
        protocolVersion: SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'bazooka', title: 'Bazooka founder board', version: '3.0.0' },
        instructions: INSTRUCTIONS,
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return rpc(id, {});
    case 'tools/list':
      return rpc(id, { tools: toolsFor(who).map((t) => ({ name: t.name, description: t.description, inputSchema: t.input,
        annotations: { readOnlyHint: t.scope === 'board:read', destructiveHint: false, openWorldHint: false } })) });
    case 'tools/call': {
      try {
        const result = await callTool(who, params.name, params.arguments || {});
        return rpc(id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false });
      } catch (err) {
        // Tool errors go back to the model as results so it can correct itself.
        const known = err instanceof HttpError;
        if (!known) console.error(err);
        return rpc(id, { content: [{ type: 'text', text: known ? err.message : 'Bazooka hit an error. Try again; if it keeps happening, tell the admin.' }], isError: true });
      }
    }
    default:
      return isNotification ? null : rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

export default async function mcp(req, res) {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-robots-tag', 'noindex');
  if (req.method === 'GET' || req.method === 'DELETE') {
    res.setHeader('allow', 'POST');
    return res.status(405).json(rpcErr(null, -32000, 'This MCP server is stateless: POST JSON-RPC messages only.'));
  }
  if (req.method !== 'POST') return res.status(405).end();

  let who;
  try { who = await authenticate(req, { allowAgents: true }); }
  catch (err) {
    res.setHeader('www-authenticate', 'Bearer realm="bazooka", error="invalid_token"');
    return res.status(err.status || 401).json(rpcErr(null, -32001, err.message));
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json(rpcErr(null, -32700, 'Parse error')); } }
  const batch = Array.isArray(body);
  const replies = (await Promise.all((batch ? body : [body]).map((m) => handle(m, who)))).filter(Boolean);
  if (!replies.length) return res.status(202).end();
  return res.status(200).json(batch ? replies : replies[0]);
}
