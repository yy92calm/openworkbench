import { describe, expect, it } from 'vitest';

import { RICH_FENCE_LANGUAGES, splitRichFences } from './fences';

const LANGS = RICH_FENCE_LANGUAGES;

describe('splitRichFences', () => {
  it('passes text without rich fences through as a single md segment', () => {
    const text = 'hello **world**\n\n```js\nconst a = 1;\n```\n\ndone';
    expect(splitRichFences(text, LANGS)).toEqual([{ kind: 'md', text }]);
  });

  it('extracts a closed html fence and keeps surrounding prose in order', () => {
    const segments = splitRichFences('before\n\n```html\n<p>hi</p>\n```\n\nafter', LANGS);
    expect(segments).toEqual([
      { kind: 'md', text: 'before\n' },
      { kind: 'fence', index: 0, language: 'html', content: '<p>hi</p>', closed: true },
      { kind: 'md', text: '\nafter' },
    ]);
  });

  it('handles multiple fences with stable occurrence indexes', () => {
    const segments = splitRichFences(
      ['a', '```svg', '<svg/>', '```', 'b', '```echarts', '{}', '```', 'c'].join('\n'),
      LANGS,
    );
    expect(segments).toHaveLength(5);
    expect(segments[0]).toEqual({ kind: 'md', text: 'a' });
    expect(segments[1]).toMatchObject({ kind: 'fence', index: 0, language: 'svg' });
    expect(segments[3]).toMatchObject({
      kind: 'fence',
      index: 1,
      language: 'echarts',
      content: '{}',
      closed: true,
    });
    expect(segments[4]).toEqual({ kind: 'md', text: 'c' });
  });

  it('keeps content from an unclosed trailing fence and hides the tail', () => {
    const segments = splitRichFences('intro\n```html\n<p>half', LANGS);
    expect(segments).toEqual([
      { kind: 'md', text: 'intro' },
      { kind: 'fence', index: 0, language: 'html', content: '<p>half', closed: false },
    ]);
  });

  it('reveals the prose after a fence once it closes', () => {
    const open = splitRichFences('intro\n```html\n<p>x</p>\n', LANGS);
    expect(open[1]).toMatchObject({ closed: false });
    const closed = splitRichFences('intro\n```html\n<p>x</p>\n```\n\noutro', LANGS);
    expect(closed).toEqual([
      { kind: 'md', text: 'intro' },
      { kind: 'fence', index: 0, language: 'html', content: '<p>x</p>', closed: true },
      { kind: 'md', text: '\noutro' },
    ]);
  });

  it('does not treat unlisted languages as rich fences, even inside other fences', () => {
    // A ```html line inside a python fence is fence body, exactly as markdown
    // would see it (no nested fencing) — the whole block stays md text.
    const text = '```python\nprint(1)\n```html\n```\n```';
    expect(splitRichFences(text, LANGS)).toEqual([{ kind: 'md', text }]);
  });

  it('ignores language tags with extra characters or wrong case', () => {
    const segments = splitRichFences('```HTML\n<p>x</p>\n```\n```html title\n<p>y</p>\n```', LANGS);
    expect(segments).toEqual([
      { kind: 'md', text: '```HTML\n<p>x</p>\n```\n```html title\n<p>y</p>\n```' },
    ]);
  });

  it('closes a rich fence on the first exact ``` line inside its body', () => {
    const segments = splitRichFences('```html\n<div>\n```\n</div>tail', LANGS);
    expect(segments).toEqual([
      { kind: 'fence', index: 0, language: 'html', content: '<div>', closed: true },
      { kind: 'md', text: '</div>tail' },
    ]);
  });

  it('preserves blank lines and trailing newline semantics of md segments', () => {
    const segments = splitRichFences('a\n\n```svg\n<svg/>\n\n```\n\nc\n', LANGS);
    expect(segments[0]).toEqual({ kind: 'md', text: 'a\n' });
    expect(segments[1]).toMatchObject({ content: '<svg/>\n' });
    expect(segments[2]).toEqual({ kind: 'md', text: '\nc\n' });
  });

  it('accepts fence markers with leading spaces (markdown allows up to 3)', () => {
    const segments = splitRichFences('  ```html\n<b>x</b>\n  ```', LANGS);
    expect(segments).toEqual([
      { kind: 'fence', index: 0, language: 'html', content: '<b>x</b>', closed: true },
    ]);
  });
});

describe('csv/tsv rich fences', () => {
  it('splits a closed csv fence as a rich segment', () => {
    const segs = splitRichFences('看数据：\n\n```csv\na,b\n1,2\n```\n\n完', LANGS);
    expect(segs).toHaveLength(3);
    expect(segs[1]).toMatchObject({ kind: 'fence', language: 'csv', closed: true });
  });

  it('treats a tsv fence the same way', () => {
    const segs = splitRichFences('```tsv\na\tb\n1\t2\n```', LANGS);
    expect(segs[0]).toMatchObject({ kind: 'fence', language: 'tsv', closed: true });
  });

  it('hides a still-streaming csv fence', () => {
    const segs = splitRichFences('```csv\na,b\n1,', LANGS);
    const last = segs[segs.length - 1];
    expect(last.kind === 'fence' ? last.closed : true).toBe(false);
  });
});
