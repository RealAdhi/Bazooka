// Fill the six message templates for a founder + connection, on the server, the same way the board does.
// {{field}} or {{field|fallback}}; missing values become [field] so blanks stay visible.

const PH = /\{\{(\w+)(?:\|([^}]*))?\}\}/g;

export function fill(template, values) {
  const blanks = [];
  const text = template.replace(PH, (_, key, fallback) => {
    const v = values[key];
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v);
    if (fallback !== undefined) return fallback;
    blanks.push(key);
    return `[${key}]`;
  });
  return { text, blanks };
}

const HONORIFIC = /^(dr|mr|mrs|ms|miss|prof|professor|sir|shri|smt)\.?$/i;
// How Piyush would address someone: their first name, or "Dr Mehta" when the name starts with a title.
export function addressName(full, first) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length && HONORIFIC.test(parts[0])) return parts.length > 1 ? `${parts[0].replace(/\.$/, '')} ${parts[parts.length - 1]}` : null;
  if (first && !HONORIFIC.test(first)) return first;
  return parts[0] || null;
}

// founder: row with person, company; connection: row with person; variables: registry rows (for fallbacks)
export function valuesFor(founder, connection, variables = []) {
  const v = {
    founder_first_name: addressName(founder.person?.full_name, founder.person?.first_name),
    company: founder.company?.name,
    one_liner: founder.company?.one_liner,
    source_event: founder.source_event,
    stage: founder.stage,
    raise_clause: founder.raise_clause,
    founder_highlight: founder.founder_highlight,
    advice_topic: founder.advice_topic,
    recent_signal: founder.recent_signal,
    strategy_topic: founder.strategy_topic,
    connection_first_name: addressName(connection?.person?.full_name, connection?.person?.first_name),
    connection_title: connection?.title || connection?.person?.title,
    connection_org: connection?.org || connection?.person?.org,
    connection_relevance: connection?.relevance,
    connection_thesis: connection?.thesis,
  };
  for (const row of variables) if ((v[row.key] === undefined || v[row.key] === null) && row.fallback != null && row.scope === 'meta') v[row.key] = row.fallback;
  return v;
}

export function renderAll(templates, founder, connection, variables) {
  const values = valuesFor(founder, connection, variables);
  return templates.map((t) => {
    const body = fill(t.body, values);
    const subject = t.subject ? fill(t.subject, values) : null;
    return { key: t.key, title: t.title, channel: t.channel, subject: subject?.text ?? null, text: body.text,
             blanks: [...new Set([...body.blanks, ...(subject?.blanks || [])])] };
  });
}
