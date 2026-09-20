import { describe, expect, it } from 'vitest';

import { stripAnsi } from './ansi';

describe('stripAnsi', () => {
  it('removes SGR color sequences and keeps the text', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m and \x1b[1;32mbold green\x1b[0m')).toBe(
      'red and bold green',
    );
  });

  it('removes cursor/erase CSI sequences entirely', () => {
    expect(stripAnsi('a\x1b[2J\x1b[1;1Hb\x1b[Kc')).toBe('abc');
  });

  it('removes OSC sequences (window title etc.)', () => {
    expect(stripAnsi('\x1b]0;My Title\x07body')).toBe('body');
    expect(stripAnsi('x\x1b]2;other\x1b\\y')).toBe('xy');
  });

  it('removes charset selection escapes', () => {
    expect(stripAnsi('\x1b(Babc\x1b)0').trim()).toBe('abc');
  });

  it('leaves plain text untouched', () => {
    const text = '普通文本 with `code` and 中文 ok\nsecond line';
    expect(stripAnsi(text)).toBe(text);
  });

  it('preserves line structure in mixed content', () => {
    expect(stripAnsi('\x1b[32mok\x1b[0m\n\x1b[31mfail\x1b[0m\n')).toBe('ok\nfail\n');
  });
});
