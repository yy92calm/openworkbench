import { describe, expect, it } from 'vitest';

import { groupRowsByDirectory } from './Sidebar';

const row = (id: string, kind: 'session' | 'example' = 'session') => ({
  id,
  title: `Session ${id}`,
  to: `/live/${id}`,
  kind,
});

describe('groupRowsByDirectory', () => {
  it('returns a single group for sessions in the same directory', () => {
    const rows = [row('s1'), row('s2')];
    const sessions = [
      { id: 's1', directory: '/ws/project-a' },
      { id: 's2', directory: '/ws/project-a' },
    ];
    const { groups, exampleRows } = groupRowsByDirectory(rows, sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0][0]).toBe('/ws/project-a');
    expect(groups[0][1]).toHaveLength(2);
    expect(exampleRows).toHaveLength(0);
  });

  it('splits sessions into multiple groups by directory', () => {
    const rows = [row('s1'), row('s2'), row('s3')];
    const sessions = [
      { id: 's1', directory: '/ws/alpha' },
      { id: 's2', directory: '/ws/beta' },
      { id: 's3', directory: '/ws/alpha' },
    ];
    const { groups } = groupRowsByDirectory(rows, sessions);
    expect(groups).toHaveLength(2);
    const alpha = groups.find(([dir]) => dir === '/ws/alpha');
    const beta = groups.find(([dir]) => dir === '/ws/beta');
    expect(alpha![1]).toHaveLength(2);
    expect(beta![1]).toHaveLength(1);
  });

  it("sessions without a directory fall into the '默认' group", () => {
    const rows = [row('s1'), row('s2')];
    const sessions = [
      { id: 's1', directory: '/ws/alpha' },
      { id: 's2' }, // no directory
    ];
    const { groups } = groupRowsByDirectory(rows, sessions);
    expect(groups).toHaveLength(2);
    const def = groups.find(([dir]) => dir === '默认');
    expect(def).toBeDefined();
    expect(def![1]).toHaveLength(1);
    expect(def![1][0].id).toBe('s2');
  });

  it('examples are separated from session groups', () => {
    const rows = [row('s1'), row('e1', 'example'), row('e2', 'example')];
    const sessions = [{ id: 's1', directory: '/ws/x' }];
    const { groups, exampleRows } = groupRowsByDirectory(rows, sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0][1]).toHaveLength(1);
    expect(exampleRows).toHaveLength(2);
    expect(exampleRows.every((r) => r.kind === 'example')).toBe(true);
  });

  it('returns empty groups for empty input', () => {
    const { groups, exampleRows } = groupRowsByDirectory([], []);
    expect(groups).toHaveLength(0);
    expect(exampleRows).toHaveLength(0);
  });

  it('preserves row order within a group', () => {
    const rows = [row('s3'), row('s1'), row('s2')];
    const sessions = [
      { id: 's1', directory: '/ws/a' },
      { id: 's2', directory: '/ws/a' },
      { id: 's3', directory: '/ws/a' },
    ];
    const { groups } = groupRowsByDirectory(rows, sessions);
    expect(groups[0][1].map((r) => r.id)).toEqual(['s3', 's1', 's2']);
  });
});
