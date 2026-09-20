// @vitest-environment node

import { emptyMacroSnapshot, type MacroDashboardSnapshot } from '@workbench/shared';
import { describe, expect, it } from 'vitest';

import { detectAlerts, isDuplicate } from './macroNotify';

function snap(patch: {
  index?: { secid: string; name: string; price: number; changePct: number };
  cn10y?: number;
  fx?: number;
}): MacroDashboardSnapshot {
  const s = emptyMacroSnapshot();
  if (patch.index) {
    s.data.indices.push({
      secid: patch.index.secid,
      code: 'x',
      name: patch.index.name,
      price: patch.index.price,
      changePct: patch.index.changePct,
      change: null,
    });
  }
  if (patch.cn10y !== undefined) {
    s.data.yields.push({
      date: '2026-09-18',
      cn2y: null,
      cn5y: null,
      cn10y: patch.cn10y,
      cn30y: null,
      cn10y2y: null,
      us10y: null,
    });
  }
  if (patch.fx !== undefined) {
    s.data.fx = { pair: 'USDCNH', name: '美元兑离岸人民币', price: patch.fx };
  }
  return s;
}

const HS300 = { secid: '1.000300', name: '沪深300', price: 4507.39, changePct: 1.06 };

describe('detectAlerts', () => {
  it('never alerts on the first refresh (no baseline)', () => {
    expect(detectAlerts(null, snap({ index: { ...HS300, changePct: 2.2 } }))).toEqual([]);
  });

  it('alerts when a major index day move crosses the threshold', () => {
    const out = detectAlerts(snap({}), snap({ index: { ...HS300, changePct: 1.8 } }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ dedupeKey: 'index:1.000300:up', indicator: '1.000300' });
    expect(out[0].title).toBe('沪深300 +1.80%');
  });

  it('stays quiet below the index threshold', () => {
    expect(detectAlerts(snap({}), snap({ index: { ...HS300, changePct: 1.2 } }))).toEqual([]);
  });

  it('alerts on a >=5bp move in the China 10Y yield', () => {
    const out = detectAlerts(snap({ cn10y: 1.62 }), snap({ cn10y: 1.682 }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ dedupeKey: 'cn10y:up', indicator: 'cn10y' });
    expect(out[0].title).toBe('中债 10Y 收益率 +6bp');
  });

  it('stays quiet on small yield moves', () => {
    expect(detectAlerts(snap({ cn10y: 1.66 }), snap({ cn10y: 1.682 }))).toEqual([]);
  });

  it('alerts on a >=0.3% USDCNH move', () => {
    const out = detectAlerts(snap({ fx: 6.67 }), snap({ fx: 6.6996 }));
    expect(out).toHaveLength(1);
    expect(out[0].indicator).toBe('usdcnh');
    expect(out[0].dedupeKey).toBe('usdcnh:up');
  });

  it('stays quiet on small FX moves', () => {
    expect(detectAlerts(snap({ fx: 6.69 }), snap({ fx: 6.6996 }))).toEqual([]);
  });
});

describe('isDuplicate', () => {
  const items = [
    {
      id: 'n1',
      kind: 'alert' as const,
      title: 't',
      createdAt: new Date('2026-09-18T10:00:00Z').toISOString(),
      read: true,
      dedupeKey: 'cn10y:up',
    },
  ];
  const now = Date.parse('2026-09-18T12:00:00Z');

  it('suppresses the same key inside the window', () => {
    expect(isDuplicate(items, 'cn10y:up', now)).toBe(true);
  });

  it('allows the same key after the window', () => {
    const later = now + 5 * 60 * 60 * 1000;
    expect(isDuplicate(items, 'cn10y:up', later)).toBe(false);
  });

  it('ignores other keys', () => {
    expect(isDuplicate(items, 'cn10y:down', now)).toBe(false);
  });
});
