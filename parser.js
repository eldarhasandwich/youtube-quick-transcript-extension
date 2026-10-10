function jsonObjectAt(text, start) {
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('Incomplete metadata JSON');
}
function initialData(html) {
  for (const pattern of [/\bytInitialData\s*=\s*/g, /window\["ytInitialData"\]\s*=\s*/g]) {
    for (const match of html.matchAll(pattern)) {
      const start = match.index + match[0].length;
      if (html[start] === '{') {
        try { return jsonObjectAt(html, start); } catch {}
      }
    }
  }
  throw new Error('Metadata: ytInitialData missing; possible consent/sign-in page.');
}
function configuration(html) {
  const config = {};
  for (const match of html.matchAll(/ytcfg\.set\(\s*/g)) {
    const start = match.index + match[0].length;
    if (html[start] === '{') {
      try { Object.assign(config, jsonObjectAt(html, start)); } catch {}
    }
  }
  return config;
}
function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
}
function transcriptParams(data) {
  let params;
  walk(data, node => {
    if (!params && typeof node.getTranscriptEndpoint?.params === 'string') params = node.getTranscriptEndpoint.params;
  });
  return params;
}
function textValue(value) {
  if (typeof value === 'string') return value;
  if (!value) return '';
  return value.simpleText ?? value.content ?? value.runs?.map(run => run.text ?? '').join('') ?? '';
}
function transcriptLines(data) {
  const lines = [];
  walk(data, node => {
    const old = node.transcriptSegmentRenderer;
    const modern = node.transcriptSegmentViewModel;
    const text = old ? textValue(old.snippet) : modern ? textValue(modern.snippet ?? modern.text) : '';
    if (typeof text === 'string' && text.trim()) lines.push(text.replace(/\s+/g, ' ').trim());
  });
  return lines;
}
