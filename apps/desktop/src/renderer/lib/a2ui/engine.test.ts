import { basicCatalog } from '@a2ui/lit/v0_9';
import { beforeEach, describe, expect, it } from 'vitest';

import { a2uiEngine, historyA2uiPartKey } from './engine';

const SID = 'session-test';
const cat = basicCatalog.id;

const createSurface = (surfaceId: string) => ({
  version: 'v0.9' as const,
  createSurface: { surfaceId, catalogId: cat },
});
const deleteSurface = (surfaceId: string) => ({
  version: 'v0.9' as const,
  deleteSurface: { surfaceId },
});

function fence(...msgs: object[]): string {
  return `\`\`\`a2ui\n${msgs.map((m) => JSON.stringify(m)).join('\n')}\n\`\`\``;
}

beforeEach(() => {
  a2uiEngine.dropSession(SID);
});

describe('a2uiEngine', () => {
  it('claims a surface under the part that created it', () => {
    a2uiEngine.feedText(SID, 'p1', fence(createSurface('s1')));
    expect(a2uiEngine.claimedSurfaces(SID, 'p1')).toHaveLength(1);
    expect(a2uiEngine.claimedSurfaces(SID, 'p2')).toHaveLength(0);
  });

  it('feeds exactly once — an identical text replay adds nothing', () => {
    const text = fence(createSurface('s1'));
    a2uiEngine.feedText(SID, 'p1', text);
    a2uiEngine.feedText(SID, 'p1', text); // reconnect / history replay
    expect(a2uiEngine.claimedSurfaces(SID, 'p1')).toHaveLength(1);
  });

  it('feeds only newly completed messages as a part streams', () => {
    const create = JSON.stringify(createSurface('s1'));
    const partial = '{"version":"v0.9","updateDataModel":';
    a2uiEngine.feedText(SID, 'p1', `\`\`\`a2ui\n${create}\n${partial}`);
    expect(a2uiEngine.claimedSurfaces(SID, 'p1')).toHaveLength(1);
    // Growing the text with a still-incomplete value must not re-feed.
    a2uiEngine.feedText(SID, 'p1', `\`\`\`a2ui\n${create}\n${partial} {"x":1}`);
    expect(a2uiEngine.claimedSurfaces(SID, 'p1')).toHaveLength(1);
    // Once the trailing value completes it is fed (still no new surface).
    a2uiEngine.feedText(SID, 'p1', `\`\`\`a2ui\n${create}\n${partial} {"x":1}}`);
    expect(a2uiEngine.claimedSurfaces(SID, 'p1')).toHaveLength(1);
  });

  it('lets a later part update an earlier surface without re-mounting it', () => {
    a2uiEngine.feedText(SID, 'p1', fence(createSurface('s1')));
    a2uiEngine.feedText(SID, 'p2', fence(createSurface('s1')));
    expect(a2uiEngine.claimedSurfaces(SID, 'p1')).toHaveLength(1);
    expect(a2uiEngine.claimedSurfaces(SID, 'p2')).toHaveLength(0);
  });

  it('preserves claim order within a part', () => {
    a2uiEngine.feedText(SID, 'p1', fence(createSurface('s-a'), createSurface('s-b')));
    const ids = a2uiEngine.claimedSurfaces(SID, 'p1').map((s) => s.id);
    expect(ids).toEqual(['s-a', 's-b']);
  });

  it('releases a claim on deleteSurface and re-claims on recreate', () => {
    a2uiEngine.feedText(SID, 'p1', fence(createSurface('d1')));
    expect(a2uiEngine.claimedSurfaces(SID, 'p1')).toHaveLength(1);
    a2uiEngine.feedText(SID, 'p2', fence(deleteSurface('d1')));
    expect(a2uiEngine.claimedSurfaces(SID, 'p1')).toHaveLength(0);
    a2uiEngine.feedText(SID, 'p3', fence(createSurface('d1')));
    expect(a2uiEngine.claimedSurfaces(SID, 'p1')).toHaveLength(0);
    expect(a2uiEngine.claimedSurfaces(SID, 'p3')).toHaveLength(1);
  });

  it('drops garbage fences and plain text without side effects', () => {
    expect(() => a2uiEngine.feedText(SID, 'p1', 'just prose')).not.toThrow();
    expect(() => a2uiEngine.feedText(SID, 'p2', fence({ broken: 'json' }))).not.toThrow();
    expect(a2uiEngine.claimedSurfaces(SID, 'p1')).toHaveLength(0);
  });

  it('ingests history under deterministic keys and is idempotent', () => {
    const messages = [
      { role: 'user' as const, parts: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant' as const, parts: [{ type: 'text', text: fence(createSurface('h1')) }] },
    ];
    a2uiEngine.ingestHistory(SID, messages);
    const key = historyA2uiPartKey(1, 0);
    expect(a2uiEngine.claimedSurfaces(SID, key)).toHaveLength(1);
    a2uiEngine.ingestHistory(SID, messages); // history reload / reconnect
    expect(a2uiEngine.claimedSurfaces(SID, key)).toHaveLength(1);
  });
});
