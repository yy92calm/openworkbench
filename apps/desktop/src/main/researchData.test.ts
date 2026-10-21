// @vitest-environment node

import type { MacroReportMeta, ResearchDecision } from '@workbench/shared';
import { describe, expect, it } from 'vitest';

import {
  applyAttribution,
  decisionsToCsv,
  isReportFile,
  latestReportsPerTheme,
  latestSubjectReport,
  mergeReviewAttributions,
  parseDecisions,
  parseReports,
  pruneReports,
  removeDecision,
  reportFileName,
  reportSlug,
  serializeDecisions,
  serializeReports,
  subjectReportFileName,
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

describe('mergeReviewAttributions', () => {
  const reviewedAt = '2026-10-20T09:00:00.000Z';

  it('reviews open decisions and leaves already-reviewed ones untouched', () => {
    const manual = decision({
      id: 'd2',
      status: 'reviewed',
      attribution: { outcome: 'partial', note: '手工归因', reviewedAt: '2026-09-20T00:00:00.000Z' },
    });
    const { list, applied } = mergeReviewAttributions(
      [decision(), manual, decision({ id: 'd3', target: '银行', model: 'industry' })],
      [
        { id: 'd1', outcome: 'hit', note: ' 相对强度延续 ' },
        { id: 'd2', outcome: 'miss', note: '不应覆盖' },
        { id: 'unknown', outcome: 'hit', note: '不存在' },
      ],
      reviewedAt,
    );
    expect(applied).toBe(1);
    expect(list[0]).toMatchObject({
      status: 'reviewed',
      attribution: { outcome: 'hit', note: '相对强度延续', reviewedAt },
    });
    expect(list[1]).toEqual(manual);
    expect(list[2].status).toBe('open');
  });

  it('is a no-op with no updates', () => {
    const list = [decision()];
    expect(mergeReviewAttributions(list, [], reviewedAt)).toEqual({ list, applied: 0 });
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

describe('subject report helpers', () => {
  const at = new Date(2026, 8, 21, 8, 31, 5);
  /** Newest-first timestamps: n = 0 is the most recent. */
  const stamp = (n: number) => new Date(Date.UTC(2026, 8, 21, 8, 31) - n * 60_000).toISOString();

  function themeMeta(n: number): MacroReportMeta {
    return {
      themeId: 'rotation-daily',
      file: `20260921-0831-rotation-daily-${n}.md`,
      createdAt: stamp(n),
      chars: 10,
    };
  }

  function subjectMeta(n: number, code = 'BK0448'): MacroReportMeta {
    return {
      subject: { kind: 'board', code, name: '电子' },
      file: `20260921-0831-board-${reportSlug(code)}-${n}.md`,
      createdAt: stamp(n),
      chars: 10,
    };
  }

  it('names subject files with a slugified code', () => {
    expect(subjectReportFileName({ kind: 'board', code: 'BK0448', name: '电子' }, at)).toBe(
      '20260921-0831-board-bk0448.md',
    );
    expect(subjectReportFileName({ kind: 'csi', code: '2.931052', name: '中证信息' }, at)).toBe(
      '20260921-0831-csi-2-931052.md',
    );
  });

  it('keeps a hostile code out of the path', () => {
    const name = subjectReportFileName({ kind: 'board', code: '../../etc/passwd', name: 'x' }, at);
    expect(name).toBe('20260921-0831-board-etc-passwd.md');
    expect(isReportFile(name)).toBe(true);
    expect(reportSlug('..')).toBe('');
  });

  it('accepts both families in the index and drops invalid subjects', () => {
    const list = [subjectMeta(0), themeMeta(0)];
    expect(parseReports(serializeReports(list))).toEqual(list);
    const bad = { ...subjectMeta(0), subject: { kind: 'nope', code: 'a', name: 'b' } };
    expect(parseReports(serializeReports([bad] as MacroReportMeta[]))).toEqual([]);
  });

  it('caps each family separately', () => {
    const list = [
      subjectMeta(0),
      themeMeta(0),
      subjectMeta(1),
      themeMeta(1),
      subjectMeta(2),
      themeMeta(2),
    ];
    expect(pruneReports(list, { theme: 2, subject: 1 }).map((r) => r.file)).toEqual([
      subjectMeta(0).file,
      themeMeta(0).file,
      themeMeta(1).file,
    ]);
  });

  it('keeps theme reports when subject reports pile up', () => {
    const many = Array.from({ length: 250 }, (_, i) => subjectMeta(i));
    const pruned = pruneReports([themeMeta(0), ...many]);
    expect(pruned.filter((r) => r.themeId)).toHaveLength(1);
    expect(pruned.filter((r) => r.subject)).toHaveLength(200);
  });

  it('drops entries that belong to neither family', () => {
    expect(pruneReports([{ file: 'x.md', createdAt: stamp(0), chars: 1 }])).toEqual([]);
  });

  it('lists themes without the subject reports', () => {
    expect(latestReportsPerTheme([subjectMeta(0), themeMeta(1)])).toEqual([themeMeta(1)]);
  });

  it('picks the newest report of exactly that subject', () => {
    const list = [
      subjectMeta(0),
      { ...subjectMeta(1), subject: { kind: 'sw' as const, code: 'BK0448', name: '电子' } },
      subjectMeta(2),
      subjectMeta(3, 'BK0473'),
    ];
    const found = latestSubjectReport(list, { kind: 'board', code: 'BK0448', name: '电子' });
    expect(found?.file).toBe(subjectMeta(0).file);
    expect(
      latestSubjectReport(list, { kind: 'csi', code: '1.000935', name: '中证信息' }),
    ).toBeNull();
  });
});
