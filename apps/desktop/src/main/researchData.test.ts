// @vitest-environment node

import type { ResearchDecision } from '@workbench/shared';
import { describe, expect, it } from 'vitest';

import {
  applyAttribution,
  decisionsToCsv,
  isReportFile,
  latestReportsPerTheme,
  parseDecisions,
  parseReports,
  removeDecision,
  reportFileName,
  serializeDecisions,
  serializeReports,
  updateDecision,
  upsertDecision,
} from './researchData';

function decision(patch: Partial<ResearchDecision> = {}): ResearchDecision {
  return {
    id: 'd1',
    model: 'rotation',
    target: '中证信息',
    stance: 'overweight',
    thesis: '相对强度领先 + 资金流入',
    createdAt: '2026-09-19T08:30:00.000Z',
    status: 'open',
    ...patch,
  };
}

describe('parseDecisions', () => {
  it('parses JSONL and skips malformed lines', () => {
    const raw = `${JSON.stringify(decision())}\n\nnot-json\n{"id":"d2"}\n${JSON.stringify(
      decision({ id: 'd3', target: '银行', model: 'industry' }),
    )}`;
    const out = parseDecisions(raw);
    expect(out.map((d) => d.id)).toEqual(['d1', 'd3']);
  });

  it('round-trips through serializeDecisions', () => {
    const list = [decision(), decision({ id: 'd2', target: '银行' })];
    expect(parseDecisions(serializeDecisions(list))).toEqual(list);
  });
});

describe('upsertDecision', () => {
  it('appends new ids and replaces existing ones in place', () => {
    const list = [decision()];
    const appended = upsertDecision(list, decision({ id: 'd2', target: '银行' }));
    expect(appended.map((d) => d.id)).toEqual(['d1', 'd2']);
    const replaced = upsertDecision(appended, decision({ id: 'd1', thesis: '修订后的理由' }));
    expect(replaced).toHaveLength(2);
    expect(replaced[0].thesis).toBe('修订后的理由');
  });
});

describe('applyAttribution', () => {
  const attribution = {
    outcome: 'hit' as const,
    note: '相对强度延续',
    reviewedAt: '2026-09-26T09:00:00.000Z',
  };

  it('marks the matching decision reviewed and keeps others untouched', () => {
    const list = [decision(), decision({ id: 'd2', target: '银行' })];
    const out = applyAttribution(list, 'd1', attribution);
    expect(out[0]).toMatchObject({ status: 'reviewed', attribution });
    expect(out[1]).toEqual(list[1]);
  });

  it('is a no-op for an unknown id', () => {
    const list = [decision()];
    expect(applyAttribution(list, 'nope', attribution)).toEqual(list);
  });
});

describe('updateDecision', () => {
  it('edits target / stance / thesis but keeps status and attribution', () => {
    const reviewed = decision({
      id: 'd2',
      status: 'reviewed',
      attribution: { outcome: 'hit', note: '已复盘', reviewedAt: '2026-09-20T00:00:00.000Z' },
    });
    const out = updateDecision([decision(), reviewed], 'd2', {
      stance: 'underweight',
      thesis: '  估值修复结束  ',
    });
    expect(out[1]).toMatchObject({
      stance: 'underweight',
      thesis: '估值修复结束',
      status: 'reviewed',
      attribution: reviewed.attribution,
      target: '中证信息',
    });
    expect(out[0]).toEqual(decision());
  });

  it('is a no-op for an unknown id', () => {
    const list = [decision()];
    expect(updateDecision(list, 'nope', { stance: 'watch' })).toEqual(list);
  });
});

describe('removeDecision', () => {
  it('drops the matching entry only', () => {
    const list = [decision(), decision({ id: 'd2', target: '银行' })];
    expect(removeDecision(list, 'd1').map((d) => d.id)).toEqual(['d2']);
    expect(removeDecision(list, 'nope')).toEqual(list);
  });
});

describe('decisionsToCsv', () => {
  it('escapes quotes/commas/newlines and starts with a BOM', () => {
    const list = [
      decision({ thesis: '相对强度领先，注意"回撤"' }),
      decision({
        id: 'd2',
        target: '银行',
        status: 'reviewed',
        attribution: {
          outcome: 'partial',
          note: '节奏\n偏差',
          reviewedAt: '2026-09-26T09:00:00.000Z',
        },
      }),
    ];
    const csv = decisionsToCsv(list);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('记录时间');
    expect(csv).toContain('"相对强度领先，注意""回撤"""');
    expect(csv).toContain('"节奏\n偏差"');
  });

  it('returns just the header for an empty ledger', () => {
    const csv = decisionsToCsv([]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.trimEnd().split('\n')).toHaveLength(1);
    expect(csv).toContain('id,记录时间');
  });
});

describe('report helpers', () => {
  it('names report files with a timestamp and theme id', () => {
    const at = new Date(2026, 8, 21, 8, 31, 5);
    expect(reportFileName('rotation-daily', at)).toBe('20260921-0831-rotation-daily.md');
  });

  it('accepts only generated report names', () => {
    expect(isReportFile('20260921-0831-rotation-daily.md')).toBe(true);
    expect(isReportFile('../decisions.jsonl')).toBe(false);
    expect(isReportFile('index.json')).toBe(false);
    expect(isReportFile('20260921-0831-rotation-daily.md/../../x')).toBe(false);
  });

  it('round-trips the index and drops malformed entries', () => {
    const list = [
      {
        themeId: 'rotation-daily' as const,
        file: '20260921-0831-rotation-daily.md',
        createdAt: '2026-09-21T08:31:00.000Z',
        chars: 1200,
      },
    ];
    expect(parseReports(serializeReports(list))).toEqual(list);
    expect(parseReports('not json')).toEqual([]);
    expect(parseReports('[{"themeId":"rotation-daily"},null]')).toEqual([]);
  });

  it('keeps the latest report per theme, newest first', () => {
    const meta = (themeId: 'rotation-daily' | 'review-weekly', createdAt: string) => ({
      themeId,
      file: `${createdAt.slice(0, 10).replace(/-/g, '')}-0800-${themeId}.md`,
      createdAt,
      chars: 100,
    });
    const out = latestReportsPerTheme([
      meta('rotation-daily', '2026-09-19T08:31:00.000Z'),
      meta('review-weekly', '2026-09-18T16:02:00.000Z'),
      meta('rotation-daily', '2026-09-21T08:31:00.000Z'),
    ]);
    expect(out.map((r) => r.createdAt)).toEqual([
      '2026-09-21T08:31:00.000Z',
      '2026-09-18T16:02:00.000Z',
    ]);
    expect(out[0].file).toBe('20260921-0800-rotation-daily.md');
  });
});
