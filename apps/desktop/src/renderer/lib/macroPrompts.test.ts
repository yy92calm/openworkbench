// @vitest-environment node

import {
  applyCanonicalIndexNames,
  attachRotationDeltas,
  boardPePercentile,
  buildCoreIndicatorLines,
  buildIndicatorLine,
  buildIndustryPrompt,
  buildMacroConclusion,
  buildMacroPrompt,
  buildMacroReportMarkdown,
  buildMacroSummarySentence,
  buildReviewPrompt,
  buildRotationPrompt,
  computeRotation,
  emptyMacroSnapshot,
  type MacroBoard,
  type MacroDashboardSnapshot,
  type MacroIndustryDetail,
  type MacroKlinePoint,
  type MacroQuote,
  type ResearchContext,
  type RotationRow,
} from '@workbench/shared';
import { describe, expect, it } from 'vitest';

function quote(secid: string, name: string): MacroQuote {
  return { secid, code: secid.split('.')[1], name, price: 100, changePct: 0, change: 0 };
}

function board(code: string, pe: number | null): MacroBoard {
  return { code, name: code, changePct: 0, turnover: 0, mainInflow: 0, mcap: 0, pe };
}

function rotationRow(secid: string, score: number | null): RotationRow {
  return {
    secid,
    name: secid,
    ret60: 0.1,
    rs60: 0.05,
    trend: true,
    vol60: 0.2,
    score,
    signal: score === null ? null : 'neutral',
    scoreDelta: null,
  };
}

function kline(closes: number[]): MacroKlinePoint[] {
  return closes.map((close, i) => ({
    date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
    close,
  }));
}

function linear(from: number, to: number, n = 30): number[] {
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

describe('computeRotation', () => {
  const industries = [
    { secid: '1.000935', name: '中证信息', klines: kline(linear(100, 200)) },
    { secid: '1.000932', name: '中证消费', klines: kline(linear(100, 100)) },
    { secid: '1.000934', name: '中证金融', klines: kline(linear(100, 50)) },
  ];
  const hs300 = kline(linear(100, 100));

  it('ranks relative strength and momentum into signals', () => {
    const rows = computeRotation(industries, hs300);
    expect(rows.map((r) => r.name)).toEqual(['中证信息', '中证消费', '中证金融']);
    expect(rows[0]).toMatchObject({ score: 100, signal: 'overweight', trend: true });
    expect(rows[1].signal).toBe('neutral');
    expect(rows[2].signal).toBe('underweight');
    expect(rows[0].rs60).toBeCloseTo(1, 5);
    expect(rows[2].ret60).toBeCloseTo(-0.5, 5);
  });

  it('degrades gracefully without enough history', () => {
    const rows = computeRotation([{ secid: 'x', name: 'X', klines: [] }], []);
    expect(rows).toHaveLength(1);
    // No inputs → no score/signal/trend; never a fake "neutral 40".
    expect(rows[0]).toMatchObject({ score: null, signal: null, ret60: null, trend: null });
  });

  it('sorts unscored rows below scored ones', () => {
    const rows = computeRotation(
      [
        { secid: 'ok', name: 'OK', klines: kline(linear(100, 120)) },
        { secid: 'bad', name: 'BAD', klines: [] },
      ],
      kline(linear(100, 100)),
    );
    expect(rows.map((r) => r.name)).toEqual(['OK', 'BAD']);
    expect(rows[0].score).toBe(100);
    expect(rows[1].score).toBeNull();
  });
});

describe('applyCanonicalIndexNames', () => {
  it('replaces data-source names with canonical ones and keeps unknown secids', () => {
    const names = applyCanonicalIndexNames([
      quote('1.000929', '800材料'),
      quote('1.000928', '中证能源'),
      quote('1.000011', '基金指数'),
      quote('1.999999', '某指数'),
    ]).map((q) => q.name);
    expect(names).toEqual(['中证材料', '中证能源', '上证基金指数', '某指数']);
  });
});

describe('attachRotationDeltas', () => {
  it('computes deltas vs the previous trading day and leaves gaps null', () => {
    const rows = [rotationRow('a', 80), rotationRow('b', 60), rotationRow('c', null)];
    const withDeltas = attachRotationDeltas(rows, { a: 70, b: 60, c: 55 });
    expect(withDeltas.map((r) => r.scoreDelta)).toEqual([10, 0, null]);
  });

  it('sets every delta to null when there is no previous day', () => {
    expect(attachRotationDeltas([rotationRow('a', 80)], null)[0].scoreDelta).toBeNull();
  });
});

describe('boardPePercentile', () => {
  it('ranks against positive-PE boards only', () => {
    const boards = [board('a', 10), board('b', 20), board('c', null), board('d', -5)];
    expect(boardPePercentile(boards, 20)).toBe(100);
    expect(boardPePercentile(boards, 10)).toBe(50);
    expect(boardPePercentile(boards, 15)).toBe(50);
    expect(boardPePercentile(boards, null)).toBeNull();
    expect(boardPePercentile(boards, -1)).toBeNull();
    expect(boardPePercentile([], 15)).toBeNull();
  });
});

function filledSnapshot(): MacroDashboardSnapshot {
  const s = emptyMacroSnapshot();
  s.fetchedAt = '2026-09-19T08:00:00.000Z';
  s.data.yields = [
    {
      date: '2026-09-18',
      cn2y: 1.25,
      cn5y: 1.4,
      cn10y: 1.682,
      cn30y: 2.12,
      cn10y2y: 0.43,
      us10y: 4.9,
    },
  ];
  s.data.macro = [
    {
      id: 'pmi',
      name: '制造业 PMI',
      unit: '',
      latest: { date: '2026-08-01', period: '2026年08月份', value: 49.8 },
      history: [],
    },
  ];
  s.data.fx = { pair: 'USDCNH', name: '美元兑离岸人民币', price: 6.6996 };
  s.data.rotation = [
    {
      secid: '1.000935',
      name: '中证信息',
      ret60: 0.12,
      rs60: 0.08,
      trend: true,
      vol60: 0.22,
      score: 92,
      signal: 'overweight',
      scoreDelta: null,
    },
    {
      secid: '1.000934',
      name: '中证金融',
      ret60: -0.04,
      rs60: -0.08,
      trend: false,
      vol60: 0.15,
      score: 18,
      signal: 'underweight',
      scoreDelta: null,
    },
  ];
  s.data.boards = [
    {
      code: 'BK0448',
      name: '电子',
      changePct: 2.81,
      turnover: 3.1,
      mainInflow: 1.985e10,
      mcap: 2.464e13,
      pe: 69.2,
    },
    {
      code: 'BK0473',
      name: '银行',
      changePct: -0.4,
      turnover: 0.5,
      mainInflow: -2.1e9,
      mcap: 1.603e13,
      pe: 7.26,
    },
  ];
  return s;
}

const research: ResearchContext = {
  decisions: [
    {
      id: 'd1',
      model: 'rotation',
      target: '中证信息',
      stance: 'overweight',
      thesis: '相对强度领先',
      createdAt: '2026-09-18T08:30:00.000Z',
      status: 'open',
    },
    {
      id: 'd2',
      model: 'industry',
      target: '银行',
      stance: 'underweight',
      thesis: '估值修复空间有限',
      createdAt: '2026-09-17T09:00:00.000Z',
      status: 'reviewed',
      attribution: { outcome: 'hit', note: '走势验证', reviewedAt: '2026-09-19T09:00:00.000Z' },
    },
  ],
  digest: '轮动口径：相对强度优先于绝对收益。',
};

describe('buildIndicatorLine', () => {
  it('formats label, value and optional date', () => {
    expect(buildIndicatorLine('沪深300', '4507.39（+1.06%）', '2026-09-18')).toBe(
      '- 沪深300 4507.39（+1.06%）（2026-09-18）',
    );
    expect(buildIndicatorLine('中债 10Y 收益率', '1.682%')).toBe('- 中债 10Y 收益率 1.682%');
  });
});

describe('buildRotationPrompt', () => {
  it('injects the scoring table, flows, macro inputs and research context', () => {
    const prompt = buildRotationPrompt(filledSnapshot(), research);
    expect(prompt).toContain('行业轮动周报');
    expect(prompt).toContain('0.45×相对强度');
    expect(prompt).toContain('- 中证信息：60 日 12.00%');
    expect(prompt).toContain('电子');
    expect(prompt).toContain('【宏观输入】');
    expect(prompt).toContain('中债 10Y 收益率 1.682%');
    expect(prompt).toContain('【知识资产摘要】');
    expect(prompt).toContain('轮动口径');
    expect(prompt).toContain('【未归因决策】');
    expect(prompt).toContain('中证信息');
    expect(prompt).toContain('【已归因决策】');
    expect(prompt).toContain('命中');
  });

  it('degrades gracefully without a snapshot', () => {
    const prompt = buildRotationPrompt(null, null);
    expect(prompt).toContain('轮动数据未就绪');
    expect(prompt).toContain('资金流数据未就绪');
    expect(prompt).toContain('宏观输入');
  });

  it('marks degraded rows and injects score changes', () => {
    const s = filledSnapshot();
    s.data.rotation = [
      { ...s.data.rotation[0], scoreDelta: 8 },
      {
        secid: '1.000930',
        name: '中证工业',
        ret60: null,
        rs60: null,
        trend: null,
        vol60: null,
        score: null,
        signal: null,
        scoreDelta: null,
      },
    ];
    const prompt = buildRotationPrompt(s, null);
    expect(prompt).toContain('较上一交易日 +8');
    expect(prompt).toContain('- 中证工业：历史数据不足，未参与评分');
  });
});

describe('buildMacroConclusion', () => {
  it('lists the full signal name lists and the strongest mover per direction', () => {
    const s = filledSnapshot();
    s.data.rotation = [
      { ...s.data.rotation[0], scoreDelta: 8 },
      { ...rotationRow('1.000933', 70), name: '中证消费', signal: 'overweight', scoreDelta: 3 },
      { ...rotationRow('1.000930', 40), name: '中证工业', scoreDelta: -6 },
      s.data.rotation[1],
    ];
    const c = buildMacroConclusion(s);
    expect(c.action).toBe('建议超配：中证信息、中证消费；建议低配：中证金融。');
    expect(c.change).toBe('较上一交易日：中证信息走强、中证工业走弱。');
  });

  it('omits the change line when no day-over-day scores exist', () => {
    const c = buildMacroConclusion(filledSnapshot());
    expect(c.action).toBe('建议超配：中证信息；建议低配：中证金融。');
    expect(c.change).toBeNull();
  });

  it('degrades without rotation data', () => {
    const c = buildMacroConclusion(null);
    expect(c.action).toContain('数据加载中');
    expect(c.change).toBeNull();
  });
});

describe('buildMacroSummarySentence', () => {
  it('joins the conclusion and change for the report', () => {
    const s = filledSnapshot();
    s.data.rotation[0].scoreDelta = 8;
    const text = buildMacroSummarySentence(s);
    expect(text).toBe('建议超配：中证信息；建议低配：中证金融。 较上一交易日：中证信息走强。');
    // Ledger / knowledge numbers live in the KPI row, not in the sentence.
    expect(text).not.toContain('决策台账');
    expect(text).not.toContain('知识资产');
  });

  it('degrades without rotation data', () => {
    expect(buildMacroSummarySentence(null)).toContain('数据加载中');
  });
});

describe('buildMacroReportMarkdown', () => {
  it('renders the leadership report sections', () => {
    const s = filledSnapshot();
    s.data.rotation[0].scoreDelta = 8;
    s.fetchedAt = '2026-09-19T08:00:00.000Z';
    s.sources.indices = { status: 'ready', fetchedAt: '2026-09-19T08:00:00.000Z' };
    const md = buildMacroReportMarkdown(s, research.decisions, research.digest);
    expect(md).toContain('# 宏观洞察 · 投研汇报');
    expect(md).toContain('## 摘要');
    expect(md).toContain('建议超配：中证信息；建议低配：中证金融。');
    expect(md).toContain('较上一交易日：中证信息走强。');
    expect(md).toContain('## 关键指标');
    expect(md).toContain('## 闭环进度');
    expect(md).toContain('## 轮动信号（中证十大行业）');
    expect(md).toContain('| 中证信息 | 12.00% | 8.00% | 20 日线上 | 22.00% | 92 | +8 | 超配 |');
    expect(md).toContain('## 决策台账');
    expect(md).toContain('## 数据源状态');
    expect(md).toContain('市场行情：就绪');
    expect(md).toContain('不构成投资建议');
  });

  it('degrades gracefully with no snapshot or decisions', () => {
    const md = buildMacroReportMarkdown(null, [], null);
    expect(md).toContain('数据加载中');
    expect(md).toContain('轮动数据未就绪');
    expect(md).toContain('暂无决策记录');
  });
});

function industryDetail(): MacroIndustryDetail {
  return {
    board: {
      code: 'BK0473',
      name: '银行',
      changePct: -0.4,
      turnover: 0.5,
      mainInflow: -2.1e9,
      mcap: 1.603e13,
      pe: 7.26,
    },
    klines: kline(linear(100, 105)),
    constituents: [
      {
        code: '601398',
        name: '工商银行',
        price: 8.07,
        changePct: -0.86,
        pe: 7.69,
        pb: 0.73,
        mcap: 2.8e12,
      },
      {
        code: '600036',
        name: '招商银行',
        price: 40.59,
        changePct: 0.12,
        pe: 6.7,
        pb: 0.9,
        mcap: 1.0e12,
      },
    ],
    peMedian: 7.2,
    pbMedian: 0.82,
    pePercentile: 30,
    fetchedAt: '2026-09-19T08:00:00.000Z',
  };
}

describe('buildIndustryPrompt', () => {
  it('injects pricing data and the three-factor framework', () => {
    const prompt = buildIndustryPrompt(industryDetail(), filledSnapshot(), research);
    expect(prompt).toContain('行业定价分析」：银行（BK0473）');
    expect(prompt).toContain('板块 PE 7.26');
    expect(prompt).toContain('市值 TOP100 板块分位 30%');
    expect(prompt).toContain('PE 7.20 / PB 0.82');
    expect(prompt).toContain('工商银行');
    expect(prompt).toContain('盈利 → 估值 → 情绪');
    expect(prompt).toContain('【未归因决策】');
  });
});

describe('buildReviewPrompt', () => {
  it('asks the agent to update the knowledge asset', () => {
    const prompt = buildReviewPrompt(research);
    expect(prompt).toContain('复盘与再训练');
    expect(prompt).toContain('.workbench/research/knowledge.md');
    expect(prompt).toContain('轮动口径');
  });

  it('works with no research context', () => {
    expect(buildReviewPrompt(null)).toContain('暂无决策与知识资产记录');
  });
});

describe('buildMacroPrompt', () => {
  it('routes the three model templates', () => {
    expect(buildMacroPrompt('rotation-daily', filledSnapshot())).toContain('行业轮动日报');
    expect(buildMacroPrompt('rotation-weekly', filledSnapshot())).toContain('行业轮动周报');
    expect(buildMacroPrompt('review-weekly', null)).toContain('复盘与再训练');
    expect(buildMacroPrompt('nope' as never, null)).toBe('');
  });
});

describe('buildCoreIndicatorLines', () => {
  it('collects the core reference lines from the snapshot', () => {
    const lines = buildCoreIndicatorLines(filledSnapshot());
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).toContain('中债 10Y 收益率 1.682%');
    expect(lines.join('\n')).toContain('美元兑离岸人民币 6.6996');
  });

  it('returns [] without a snapshot', () => {
    expect(buildCoreIndicatorLines(null)).toEqual([]);
  });
});
