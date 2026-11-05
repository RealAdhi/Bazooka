// One interface over three providers. Each call returns { provider, model, text, usage }.
// Keys come from Vercel env vars only. Provider order comes from settings.llm (admin panel).

import { CAPTURE_JSON_SCHEMA } from './capture-schema.js';

const KEYS = {
  claude: () => process.env.ANTHROPIC_API_KEY,
  gemini: () => process.env.GEMINI_API_KEY,
  grok:   () => process.env.XAI_API_KEY,
};

export function providerAvailable(p) {
  return Boolean(KEYS[p]?.());
}

// settings.llm = { order: ['notion','grok','selected'], selected: 'gemini', models: {...}, notion_available: false }
export function resolveProviders(llmSettings = {}) {
  const order = llmSettings.order || ['selected'];
  const out = [];
  for (const step of order) {
    const p = step === 'selected' ? llmSettings.selected : step;
    if (p === 'notion') continue;                // Notion AI has no callable API yet; kept in the order for later
    if (KEYS[p] && providerAvailable(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

async function postJson(url, headers, body, timeoutMs = 120000) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// messages: [{ role: 'user'|'assistant', content: string }]
async function callClaude({ model, system, messages }) {
  const data = await postJson('https://api.anthropic.com/v1/messages',
    { 'x-api-key': KEYS.claude(), 'anthropic-version': '2023-06-01' },
    {
      model, max_tokens: 8000, system, messages,
      tools: [{ name: 'record_capture', description: 'Record the structured capture.', input_schema: CAPTURE_JSON_SCHEMA }],
      tool_choice: { type: 'tool', name: 'record_capture' },
    });
  const tool = (data.content || []).find((b) => b.type === 'tool_use');
  return {
    text: tool ? JSON.stringify(tool.input) : (data.content || []).map((b) => b.text || '').join(''),
    usage: { input: data.usage?.input_tokens, output: data.usage?.output_tokens },
  };
}

async function callGemini({ model, system, messages }) {
  const data = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': KEYS.gemini() },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    });
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  return { text, usage: { input: data.usageMetadata?.promptTokenCount, output: data.usageMetadata?.candidatesTokenCount } };
}

async function callGrok({ model, system, messages }) {
  const data = await postJson('https://api.x.ai/v1/chat/completions',
    { authorization: `Bearer ${KEYS.grok()}` },
    {
      model, temperature: 0.1,
      messages: [{ role: 'system', content: system }, ...messages],
      response_format: { type: 'json_schema', json_schema: { name: 'capture', schema: CAPTURE_JSON_SCHEMA } },
    });
  return {
    text: data.choices?.[0]?.message?.content || '',
    usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens },
  };
}

const CALLERS = { claude: callClaude, gemini: callGemini, grok: callGrok };

export async function complete(provider, { model, system, messages }) {
  const call = CALLERS[provider];
  if (!call) throw new Error(`Unknown LLM provider ${provider}`);
  const r = await call({ model, system, messages });
  return { provider, model, ...r };
}
