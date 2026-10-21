// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));
vi.mock('./server', () => ({ workspaceDir: () => state.dir }));

import {
  addDecision,
  applyReviewAttributions,
  listDecisions,
  listMacroReports,
  readKnowledgeDigest,
  readSubjectReport,
  saveKnowledgeDigest,
  saveMacroReport,
  saveSubjectReport,
} from './research';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'workbench-research-'));
  state.dir = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('saveKnowledgeDigest', () => {
  it('writes knowledge.md under .workbench/research and exposes it as the digest', () => {
    const saved = saveKnowledgeDigest('# 投研知识资产\n\n- 相对强度延续时不要过早止盈。');
    expect(saved?.chars).toBeGreaterThan(0);
    const file = join(dir, '.workbench/research/knowledge.md');
    expect(readFileSync(file, 'utf-8')).toContain('不要过早止盈');
    expect(readKnowledgeDigest()).toContain('不要过早止盈');
  });

  it('keeps the existing asset when the new body is blank', () => {
    saveKnowledgeDigest('# 旧资产');
    expect(saveKnowledgeDigest('   ')).toBeNull();
    expect(readKnowledgeDigest()).toContain('旧资产');
  });
});

describe('applyReviewAttributions', () => {
  it('reviews open decisions once and never overwrites them later', () => {
    const rotation = addDecision({
      model: 'rotation',
      target: '中证信息',
      stance: 'overweight',
      thesis: '相对强度领先',
    });
    const industry = addDecision({
      model: 'industry',
      target: '银行',
      stance: 'underweight',
      thesis: '估值修复空间有限',
    });

    expect(
      applyReviewAttributions([
        { id: rotation.id, outcome: 'hit', note: '相对强度延续' },
        { id: industry.id, outcome: 'miss', note: '估值继续修复' },
      ]).applied,
    ).toBe(2);

    const list = listDecisions();
    expect(list.find((d) => d.id === rotation.id)).toMatchObject({
      status: 'reviewed',
      attribution: { outcome: 'hit', note: '相对强度延续' },
    });
    expect(list.find((d) => d.id === industry.id)?.status).toBe('reviewed');

    expect(
      applyReviewAttributions([{ id: rotation.id, outcome: 'miss', note: '不应覆盖' }]).applied,
    ).toBe(0);
    expect(listDecisions().find((d) => d.id === rotation.id)?.attribution?.outcome).toBe('hit');
  });
});

describe('saveSubjectReport', () => {
  const subject = { kind: 'board' as const, code: 'BK0448', name: '电子' };

  it('writes the body under reports/ and reads it back by subject', () => {
    const meta = saveSubjectReport({
      subject,
      sessionId: 's1',
      markdown: '# 电子行业报告\n\n超配。',
    });
    expect(meta?.file).toMatch(/^[0-9]{8}-[0-9]{4}-board-bk0448\.md$/);
    const body = readSubjectReport(subject);
    expect(body?.markdown).toContain('超配');
    expect(body?.meta.sessionId).toBe('s1');
    expect(
      readFileSync(join(dir, '.workbench/research/reports', body?.meta.file ?? ''), 'utf-8'),
    ).toContain('# 电子行业报告');
  });

  it('keeps theme reports listed while subject reports pile up', () => {
    saveMacroReport({ themeId: 'rotation-daily', markdown: '# 轮动日报' });
    for (let i = 0; i < 3; i++) saveSubjectReport({ subject, markdown: `# 电子 ${i}` });
    expect(listMacroReports().map((r) => r.themeId)).toEqual(['rotation-daily']);
    expect(readSubjectReport(subject)?.markdown).toContain('电子');
  });

  it('refuses an empty body and reports no report for an unseen subject', () => {
    expect(saveSubjectReport({ subject, markdown: '   ' })).toBeNull();
    expect(readSubjectReport(subject)).toBeNull();
  });
});
