/**
 * A2UI fence parsing — pure string logic, no DOM, no network.
 *
 * The agent emits A2UI v0.9 messages inside fenced code blocks whose info
 * string is exactly `a2ui`. Each fence body streams JSON values (typically one
 * per line, but multi-line values are fine). The runtime upserts the FULL
 * text of a part on every delta, so this module is stateless and re-parses
 * from scratch each time; feeding exactly-once happens upstream in the engine
 * (which counts consumed messages per part).
 */

export interface A2uiParseResult {
  /** `text` with every a2ui fence removed (marker lines + body). A fence that
   *  is still streaming is hidden too, from its opening line to the end of
   *  the text — raw JSON never flashes into the markdown view. */
  markdown: string;
  /** Complete JSON values from every fence body, in order of appearance.
   *  A trailing incomplete value is omitted until it closes. */
  messages: unknown[];
}

/** Fence opening line: up to 3 leading spaces (markdown rule), exact info. */
const OPEN_FENCE = /^ {0,3}```a2ui[ \t]*$/;
/** Fence closing line: a bare ``` fence terminator. */
const CLOSE_FENCE = /^ {0,3}```[ \t]*$/;

export function extractA2ui(text: string): A2uiParseResult {
  // Walk the text line by line, recording each fence's [start, end) range
  // and collecting the bodies. A fence left open at the end of the text is
  // still a range (hidden), and its body still yields complete values.
  const ranges: Array<{ start: number; end: number }> = [];
  const bodies: string[] = [];
  let inFence = false;
  let fenceStart = 0;
  let bodyStart = 0;
  let lineStart = 0;
  while (lineStart <= text.length) {
    const nl = text.indexOf('\n', lineStart);
    const lineEnd = nl === -1 ? text.length : nl;
    if (!inFence) {
      if (OPEN_FENCE.test(text.slice(lineStart, lineEnd))) {
        inFence = true;
        fenceStart = lineStart;
        // Body starts on the line after the marker (may be empty / at EOF).
        bodyStart = nl === -1 ? text.length : nl + 1;
      }
    } else if (CLOSE_FENCE.test(text.slice(lineStart, lineEnd))) {
      inFence = false;
      ranges.push({ start: fenceStart, end: nl === -1 ? text.length : nl + 1 });
      bodies.push(text.slice(bodyStart, lineStart));
    }
    if (nl === -1) break;
    lineStart = nl + 1;
  }
  if (inFence) {
    ranges.push({ start: fenceStart, end: text.length });
    bodies.push(text.slice(bodyStart));
  }

  let markdown = '';
  let cursor = 0;
  for (const r of ranges) {
    markdown += text.slice(cursor, r.start);
    cursor = r.end;
  }
  markdown += text.slice(cursor);

  const messages: unknown[] = [];
  for (const body of bodies) parseJsonValues(body, messages);
  return { markdown, messages };
}

/** Append every complete JSON value in `s` to `out`; stop at the first
 *  incomplete or invalid one (streaming resumes on the next delta). */
function parseJsonValues(s: string, out: unknown[]): void {
  let pos = 0;
  const n = s.length;
  while (pos < n) {
    while (pos < n && ' \t\r\n'.includes(s[pos])) pos++;
    if (pos >= n) return;
    const c = s[pos];
    if (c !== '{' && c !== '[') return; // prose or garbage inside a fence
    const start = pos;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; pos < n; pos++) {
      const ch = s[pos];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          pos++;
          break;
        }
      }
    }
    if (depth !== 0) return; // still streaming — wait for the closing brace
    try {
      out.push(JSON.parse(s.slice(start, pos)) as unknown);
    } catch {
      return; // invalid JSON — never completes, drop the rest of the body
    }
  }
}
