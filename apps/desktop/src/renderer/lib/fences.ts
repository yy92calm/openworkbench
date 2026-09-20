/**
 * Rich-fence splitting for the chat thread (see docs/20260906-01-rich-fence-rendering.md).
 *
 * The agent streams markdown whose ` ```html / ```svg / ```echarts ` fences the
 * viewer replaces with live previews. The fence text must never reach the
 * markdown renderer mid-stream (half-open fences would show broken code and
 * then jump), so the full message text is re-split on every `text.updated`
 * upsert — same stateless, no-cache strategy as the A2UI parser.
 */

/** Info strings whose fences render as previews instead of code blocks. */
export const RICH_FENCE_LANGUAGES = ['html', 'svg', 'echarts', 'csv', 'tsv'] as const;

export type FenceSegment =
  | { kind: 'md'; text: string }
  | {
      kind: 'fence';
      /** 0-based occurrence order of this rich fence in the message. */
      index: number;
      language: string;
      /** Raw text between the opening and closing fence lines. */
      content: string;
      /** Whether the closing ``` line has been seen (message may still stream). */
      closed: boolean;
    };

/**
 * Split markdown into text segments and rich-fence segments, preserving
 * in-message order. Rules (all line-based, mirroring markdown fence semantics):
 * - an opening line is a line whose trim is exactly ``` + language;
 * - a closing line is a line whose trim is exactly ```;
 * - a fence of a non-rich language is passed through verbatim (its body is
 *   never scanned for rich openings, matching markdown's no-nesting rule);
 * - a trailing unclosed rich fence drops everything from its opening line on
 *   (the viewer must not show half-generated content).
 */
export function splitRichFences(markdown: string, languages: readonly string[]): FenceSegment[] {
  const rich = new Set(languages);
  const lines = markdown.split('\n');
  const segments: FenceSegment[] = [];
  let md: string[] = [];
  let fence: { language: string; content: string[]; index: number } | null = null;

  const flushMd = () => {
    if (md.length) {
      segments.push({ kind: 'md', text: md.join('\n') });
      md = [];
    }
  };

  let i = 0;
  let fenceIndex = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (fence) {
      // Inside a rich fence: only an exact ``` line closes it.
      if (line.trim() === '```') {
        segments.push({
          kind: 'fence',
          index: fence.index,
          language: fence.language,
          content: fence.content.join('\n'),
          closed: true,
        });
        fence = null;
      } else {
        fence.content.push(line);
      }
      i++;
      continue;
    }
    const t = line.trim();
    if (t.startsWith('```')) {
      const language = t.slice(3).trim();
      if (rich.has(language)) {
        flushMd();
        fence = { language, content: [], index: fenceIndex++ };
        i++;
        continue;
      }
      // Non-rich fence: copy verbatim through its closing line.
      md.push(line);
      i++;
      while (i < lines.length && lines[i].trim() !== '```') {
        md.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        md.push(lines[i]);
        i++;
      }
      continue;
    }
    md.push(line);
    i++;
  }
  if (fence) {
    // Unclosed at end of text: keep content for the viewer's "truncated" state.
    segments.push({
      kind: 'fence',
      index: fence.index,
      language: fence.language,
      content: fence.content.join('\n'),
      closed: false,
    });
  }
  flushMd();
  return segments;
}
