import { describe, expect, it } from 'vitest';

import { extractA2ui } from './parser';

const create = (surfaceId: string) =>
  JSON.stringify({ version: 'v0.9', createSurface: { surfaceId, catalogId: 'basic' } });

describe('extractA2ui', () => {
  it('passes text without a2ui fences through unchanged', () => {
    const text = 'plain prose\n\n```json\n{"a":1}\n```\nmore';
    const { markdown, messages } = extractA2ui(text);
    expect(markdown).toBe(text);
    expect(messages).toEqual([]);
  });

  it('strips a fence and keeps surrounding prose', () => {
    const { markdown, messages } = extractA2ui(
      `Before.\n\n\`\`\`a2ui\n${create('s1')}\n\`\`\`\n\nAfter.`,
    );
    expect(markdown).toBe('Before.\n\n\nAfter.');
    expect(messages).toEqual([JSON.parse(create('s1'))]);
  });

  it('collects multiple messages across multiple fences in order', () => {
    const body = `${create('s1')}\n${JSON.stringify({ version: 'v0.9', updateComponents: { surfaceId: 's1', components: [] } })}`;
    const text = `A\n\`\`\`a2ui\n${body}\n\`\`\`\nB\n\`\`\`a2ui\n${create('s2')}\n\`\`\`\nC`;
    const { markdown, messages } = extractA2ui(text);
    expect(markdown).toBe('A\nB\nC');
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ createSurface: { surfaceId: 's1' } });
    expect(messages[2]).toMatchObject({ createSurface: { surfaceId: 's2' } });
  });

  it('hides a still-open fence entirely and parses its complete values', () => {
    const half = `Lead.\n\n\`\`\`a2ui\n${create('s1')}\n`;
    const { markdown, messages } = extractA2ui(half);
    expect(markdown).toBe('Lead.\n\n');
    expect(messages).toHaveLength(1);
  });

  it('hides an open fence even with zero complete messages (prose after is invisible until it closes)', () => {
    const { markdown } = extractA2ui('Lead\n```a2ui\n{"version":"v0.9","createSurface":\n');
    expect(markdown).toBe('Lead\n');
  });

  it('reveals post-fence prose once the fence closes', () => {
    const open = `Lead\n\`\`\`a2ui\n${create('s1')}\n`;
    const closed = `${open}\`\`\`\nTail`;
    expect(extractA2ui(closed).markdown).toBe('Lead\nTail');
  });

  it('streams one message per delta as it completes', () => {
    const full = create('s1');
    let text = '```a2ui\n';
    const seen: unknown[][] = [];
    for (const ch of full.split('')) {
      text += ch;
      seen.push(extractA2ui(text).messages);
    }
    // Only the final delta yields the complete message.
    expect(seen.slice(0, -1).every((m) => m.length === 0)).toBe(true);
    expect(seen.at(-1)).toHaveLength(1);
  });

  it('parses multi-line formatted JSON once complete', () => {
    const pretty =
      '{\n  "version": "v0.9",\n  "createSurface": {\n    "surfaceId": "s1",\n    "catalogId": "basic"\n  }\n}';
    expect(extractA2ui(`\`\`\`a2ui\n${pretty}\n\`\`\``).messages).toHaveLength(1);
    // ...but not before the closing brace arrives.
    expect(extractA2ui(`\`\`\`a2ui\n${pretty.slice(0, -3)}\`\`\``).messages).toEqual([]);
  });

  it('drops garbage fence bodies silently', () => {
    const text = 'X\n```a2ui\nthis is not json\n```\nY';
    const { markdown, messages } = extractA2ui(text);
    expect(markdown).toBe('X\nY');
    expect(messages).toEqual([]);
  });

  it('stops at the first invalid value inside one body but parses other fences', () => {
    const text = `\`\`\`a2ui\nbroken\n\`\`\`\n\`\`\`a2ui\n${create('s2')}\n\`\`\``;
    const { messages } = extractA2ui(text);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ createSurface: { surfaceId: 's2' } });
  });

  it('allows up to 3 leading spaces on fence markers', () => {
    const { markdown, messages } = extractA2ui('x\n   ```a2ui\n' + create('s1') + '\n   ```\ny');
    expect(messages).toHaveLength(1);
    expect(markdown).toContain('x');
    expect(markdown).toContain('y');
  });

  it('ignores an info string that merely contains a2ui', () => {
    const text = '```a2ui2\n{"a":1}\n```';
    const { markdown, messages } = extractA2ui(text);
    expect(markdown).toBe(text);
    expect(messages).toEqual([]);
  });

  it('keeps a value containing ``` intact (only a full-line ``` closes)', () => {
    const text = '```a2ui\n{"a":"```"}\n```';
    const { markdown, messages } = extractA2ui(text);
    expect(messages).toEqual([{ a: '```' }]);
    expect(markdown).toBe('');
  });
});
