// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  medianOf,
  parseBoards,
  parseConstituents,
  parseFundRank,
  parseFx,
  parseIndexQuotes,
  parseKline,
  parseMacroIndicators,
  parseTreasury,
} from './macroData';

describe('parseIndexQuotes', () => {
  const raw = JSON.stringify({
    rc: 0,
    data: {
      diff: [
        { f2: 3911.87, f3: 0.94, f4: 36.27, f12: '000001', f13: 1, f14: '上证指数' },
        { f2: '-', f3: '-', f4: '-', f12: '399001', f13: 0, f14: '深证成指' },
        { f12: '000300' }, // malformed row is skipped
      ],
    },
  });

  it('maps the ulist fields and keeps the composite secid', () => {
    const out = parseIndexQuotes(raw);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      secid: '1.000001',
      code: '000001',
      name: '上证指数',
      price: 3911.87,
      changePct: 0.94,
      change: 36.27,
    });
    expect(out[1]).toMatchObject({ secid: '0.399001', price: null, changePct: null });
  });

  it('returns [] for invalid input', () => {
    expect(parseIndexQuotes('not json')).toEqual([]);
    expect(parseIndexQuotes('{"data":{}}')).toEqual([]);
  });
});

describe('parseKline', () => {
  it('splits date,close rows', () => {
    const raw = '{"data":{"klines":["2026-08-24,4563.13","2026-08-25,4552.03"]}}';
    expect(parseKline(raw)).toEqual([
      { date: '2026-08-24', close: 4563.13 },
      { date: '2026-08-25', close: 4552.03 },
    ]);
  });

  it('skips malformed rows', () => {
    expect(parseKline('{"data":{"klines":["bad"]}}')).toEqual([]);
  });
});

describe('parseTreasury', () => {
  const row = (date: string, cn10y: number, spread: number) => ({
    SOLAR_DATE: `${date} 00:00:00`,
    EMM00588704: 1.25,
    EMM00166462: 1.4,
    EMM00166466: cn10y,
    EMM00166469: 2.1,
    EMM01276014: spread,
    EMG00001310: 4.9,
  });

  it('maps fields and sorts oldest first', () => {
    const raw = JSON.stringify({
      result: { data: [row('2026-09-18', 1.682, 0.4263), row('2026-09-17', 1.6862, 0.4312)] },
    });
    const out = parseTreasury(raw);
    expect(out).toHaveLength(2);
    expect(out[0].date).toBe('2026-09-17');
    expect(out[1]).toMatchObject({ date: '2026-09-18', cn10y: 1.682, cn10y2y: 0.4263, us10y: 4.9 });
  });

  it('returns [] when the report is missing', () => {
    expect(parseTreasury('{"result":null}')).toEqual([]);
  });
});

describe('parseMacroIndicators', () => {
  const cpi = JSON.stringify({
    result: {
      data: [
        { REPORT_DATE: '2026-08-01 00:00:00', TIME: '2026年08月份', NATIONAL_SAME: 0.8 },
        { REPORT_DATE: '2026-07-01 00:00:00', TIME: '2026年07月份', NATIONAL_SAME: 0.5 },
      ],
    },
  });

  it('builds a series with the newest value as latest', () => {
    const [out] = parseMacroIndicators('CPI', cpi);
    expect(out.id).toBe('cpi');
    expect(out.name).toBe('CPI 同比');
    expect(out.history.map((p) => p.value)).toEqual([0.5, 0.8]);
    expect(out.latest).toEqual({ date: '2026-08-01', period: '2026年08月份', value: 0.8 });
  });

  it('expands PMI into manufacturing + non-manufacturing series', () => {
    const raw = JSON.stringify({
      result: {
        data: [
          {
            REPORT_DATE: '2026-08-01 00:00:00',
            TIME: '2026年08月份',
            MAKE_INDEX: 49.8,
            NMAKE_INDEX: 49,
          },
        ],
      },
    });
    const out = parseMacroIndicators('PMI', raw);
    expect(out.map((i) => i.id)).toEqual(['pmi', 'pmi-non-mfg']);
    expect(out[0].latest?.value).toBe(49.8);
    expect(out[1].latest?.value).toBe(49);
  });

  it('degrades to a null latest on empty payloads', () => {
    const [out] = parseMacroIndicators('GDP', 'nope');
    expect(out.latest).toBeNull();
    expect(out.history).toEqual([]);
  });
});

describe('parseFx', () => {
  it('reads price, pair and label', () => {
    const raw = '{"data":{"f43":6.6996,"f57":"USDCNH","f58":"美元兑离岸人民币"}}';
    expect(parseFx(raw)).toEqual({ pair: 'USDCNH', name: '美元兑离岸人民币', price: 6.6996 });
  });

  it('returns null without data', () => {
    expect(parseFx('{"data":null}')).toBeNull();
  });
});

describe('parseFundRank', () => {
  it('parses the JS-source payload rows', () => {
    const raw =
      'var rankData = {datas:["002910,易方达供给改革混合,YFDGJGGHH,2026-09-18,8.1136,8.1136,0.54,0.24,-6.92,16.55,94.93,158.66,278.47,194.26,120.19,711.36,2017-01-25,1"]};';
    const out = parseFundRank(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      code: '002910',
      name: '易方达供给改革混合',
      navDate: '2026-09-18',
      nav: 8.1136,
      return1y: 158.66,
    });
  });

  it('returns [] when the payload has no datas block', () => {
    expect(parseFundRank('<html>error</html>')).toEqual([]);
  });
});

describe('parseBoards', () => {
  it('maps fields and dedupes levels by market cap (prefers unsuffixed names)', () => {
    const raw = JSON.stringify({
      data: {
        diff: [
          {
            f3: 1.2,
            f8: 0.8,
            f9: 7.26,
            f12: 'BK0475',
            f14: '银行Ⅱ',
            f20: 1603000000000,
            f62: -1e8,
          },
          { f3: 1.2, f8: 0.8, f9: 7.26, f12: 'BK0473', f14: '银行', f20: 1603000000000, f62: -1e8 },
          {
            f3: 2.8,
            f8: 3.1,
            f9: 69.2,
            f12: 'BK0448',
            f14: '电子',
            f20: 24640000000000,
            f62: 1.9e10,
          },
          { f3: 1, f9: '-', f12: 'BK9999', f14: '无PE板块', f20: 100, f62: 0 },
          { f3: 1, f12: '000001', f14: '平安银行', f20: 1e12 }, // not a board
        ],
      },
    });
    const out = parseBoards(raw);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ code: 'BK0473', name: '银行', mcap: 1603000000000, pe: 7.26 });
    expect(out[1]).toMatchObject({ code: 'BK0448', name: '电子', changePct: 2.8, pe: 69.2 });
    expect(out[2]).toMatchObject({ code: 'BK9999', pe: null });
  });

  it('returns [] on invalid input', () => {
    expect(parseBoards('nope')).toEqual([]);
  });
});

describe('parseConstituents', () => {
  it('drops negative or missing PE/PB and prefers PE TTM', () => {
    const raw = JSON.stringify({
      data: {
        diff: [
          {
            f2: 8.07,
            f3: -0.86,
            f9: 8.28,
            f12: '601398',
            f14: '工商银行',
            f20: 2.8e12,
            f23: 0.73,
            f115: 7.69,
          },
          {
            f2: 10.2,
            f3: 1.1,
            f9: -12.3,
            f12: '600000',
            f14: '浦发银行',
            f20: 3e11,
            f23: '-',
            f115: '-',
          },
        ],
      },
    });
    const out = parseConstituents(raw);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ code: '601398', pe: 7.69, pb: 0.73 });
    expect(out[1]).toMatchObject({ code: '600000', pe: null, pb: null });
  });
});

describe('medianOf', () => {
  it('handles odd, even and empty inputs', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
    expect(medianOf([null, 5, null])).toBe(5);
    expect(medianOf([])).toBeNull();
  });
});
