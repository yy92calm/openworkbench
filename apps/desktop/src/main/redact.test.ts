// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { redactSensitive } from './redact';

describe('redactSensitive', () => {
  it('redacts values under sensitive key names', () => {
    const input = {
      filePath: 'out/note.md',
      content: 'hello',
      apiKey: 'sk-1234567890abcdef',
      token: 'abc',
      Authorization: 'Bearer abcdefghijklmnop',
    };
    const out = redactSensitive(input) as Record<string, unknown>;
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
    expect(out.Authorization).toBe('[REDACTED]');
    expect(out.filePath).toBe('out/note.md');
    expect(out.content).toBe('hello');
  });

  it('matches common key spellings', () => {
    const out = redactSensitive({
      API_KEY: 1,
      'api-key': 2,
      access_key: 3,
      mySecret: 4,
      password: 5,
    }) as Record<string, unknown>;
    expect(out.API_KEY).toBe('[REDACTED]');
    expect(out['api-key']).toBe('[REDACTED]');
    expect(out.access_key).toBe('[REDACTED]');
    expect(out.mySecret).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
  });

  it('walks nested objects and arrays', () => {
    const out = redactSensitive({
      env: { OPENAI_API_KEY: 'sk-super-secret' },
      list: [{ token: 't' }, { ok: 1 }],
    }) as { env: Record<string, unknown>; list: unknown[] };
    expect(out.env.OPENAI_API_KEY).toBe('[REDACTED]');
    expect(out.list[0]).toEqual({ token: '[REDACTED]' });
    expect(out.list[1]).toEqual({ ok: 1 });
  });

  it('redacts inline credentials inside plain strings', () => {
    expect(redactSensitive('use sk-1234567890abcdef now')).toBe('use [REDACTED] now');
    expect(redactSensitive('auth: Bearer xyz.token.abc')).toBe('auth: [REDACTED]');
    expect(redactSensitive('jwt eyJhbGciOiJIUzI1NiJ9.abc.def')).toBe('jwt [REDACTED]');
  });

  it('leaves non-sensitive strings untouched', () => {
    const text = 'ordinary text with no secrets';
    expect(redactSensitive(text)).toBe(text);
  });

  it('handles primitives and null without throwing', () => {
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(true)).toBe(true);
    expect(redactSensitive('')).toBe('');
  });
});
