// @vitest-environment node

import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeCompactionSnapshot } from './snapshot';

function root(): string {
  return mkdtempSync(join(tmpdir(), 'snapshot-test-'));
}

describe('writeCompactionSnapshot', () => {
  it('writes a snapshot with a safe filename and round-trippable JSON', () => {
    const dir = root();
    const file = writeCompactionSnapshot(dir, {
      sessionId: 'sess/1:abc',
      historyVersion: 3,
      triggeredAt: '2026-09-01T00:00:00Z',
      messages: [{ role: 'user', text: 'hi' }],
    });
    expect(file).toBeTruthy();
    const parsed = JSON.parse(readFileSync(file!, 'utf-8'));
    expect(parsed.sessionId).toBe('sess/1:abc');
    expect(parsed.historyVersion).toBe(3);
    expect(parsed.messages).toEqual([{ role: 'user', text: 'hi' }]);
    // unsafe characters in the session id are scrubbed from the filename
    expect(file!.split('/').pop()).toBe('sess_1_abc-3.json');
  });

  it('returns null and writes nothing for an empty message list', () => {
    const dir = root();
    const file = writeCompactionSnapshot(dir, {
      sessionId: 's',
      historyVersion: 1,
      triggeredAt: '2026-09-01T00:00:00Z',
      messages: [],
    });
    expect(file).toBeNull();
    expect(existsSync(join(dir, 'compaction-snapshots'))).toBe(false);
  });

  it('prunes to SNAPSHOT_CAP files per session, keeping the newest', () => {
    const dir = root();
    for (let v = 1; v <= 25; v++) {
      writeCompactionSnapshot(dir, {
        sessionId: 'session-a',
        historyVersion: v,
        triggeredAt: `2026-09-01T00:00:${String(v).padStart(2, '0')}Z`,
        messages: [{ role: 'user', text: `v${v}` }],
      });
    }
    const files = readdirSync(join(dir, 'compaction-snapshots'));
    // 25 versions, 5 versions have been pruned (v1..v5), 20 remain.
    expect(files).toHaveLength(20);
    expect(files).toContain('session-a-6.json');
    expect(files).toContain('session-a-25.json');
    expect(files).not.toContain('session-a-5.json');
    expect(files).not.toContain('session-a-1.json');
  });

  it('keeps snapshots of different sessions independent', () => {
    const dir = root();
    for (let v = 1; v <= 3; v++) {
      writeCompactionSnapshot(dir, {
        sessionId: 'a',
        historyVersion: v,
        triggeredAt: '2026-09-01T00:00:00Z',
        messages: [{ role: 'user', text: 'a' }],
      });
    }
    writeCompactionSnapshot(dir, {
      sessionId: 'b',
      historyVersion: 1,
      triggeredAt: '2026-09-01T00:00:00Z',
      messages: [{ role: 'user', text: 'b' }],
    });
    const files = readdirSync(join(dir, 'compaction-snapshots')).sort();
    expect(files).toContain('a-1.json');
    expect(files).toContain('a-2.json');
    expect(files).toContain('a-3.json');
    expect(files).toContain('b-1.json');
  });
});
