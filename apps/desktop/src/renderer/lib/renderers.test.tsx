// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { RendererManifest } from '@workbench/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { extractConfigPatch, renderWorkbenchFence } from './renderers';
import { useUiStore } from './store';

function opts(type: string, options?: Record<string, unknown>): Map<string, RendererManifest> {
  return new Map([[type, { type, options } as RendererManifest]]);
}

describe('renderWorkbenchFence', () => {
  it('returns null for an unregistered or disabled type', () => {
    expect(renderWorkbenchFence('unknown', '{}', new Map())).toBeNull();
    expect(renderWorkbenchFence('unknown', '{}', opts('kv-card'))).toBeNull();
  });

  it('renders a kv-card from a flat object', () => {
    const node = renderWorkbenchFence(
      'kv-card',
      '{"模型":"deepseek-r1","MCP":"wind"}',
      opts('kv-card'),
    );
    expect(node).not.toBeNull();
    render(<div>{node}</div>);
    expect(screen.getByText('模型')).toBeDefined();
    expect(screen.getByText('MCP')).toBeDefined();
    expect(screen.getByText('deepseek-r1')).toBeDefined();
  });

  it('renders a kv-card with json array rows', () => {
    const node = renderWorkbenchFence(
      'kv-card',
      '[["a", 1], ["b", true]]',
      opts('kv-card', { title: '测试' }),
    );
    render(<div>{node}</div>);
    expect(screen.getByText('测试')).toBeDefined();
    expect(screen.getByText('1')).toBeDefined();
    expect(screen.getByText('true')).toBeDefined();
  });

  it('uses the single-key object as the card title', () => {
    const node = renderWorkbenchFence(
      'kv-card',
      '{"风险摘要":{"诚实性":"低","合规性":"高"}}',
      opts('kv-card'),
    );
    render(<div>{node}</div>);
    expect(screen.getByText('风险摘要')).toBeDefined();
    expect(screen.getByText('诚实性')).toBeDefined();
  });

  it('degrades gracefully on invalid JSON', () => {
    const node = renderWorkbenchFence('kv-card', 'not json', opts('kv-card'));
    render(<div>{node}</div>);
    expect(document.body.textContent).toContain('not json');
  });
});

describe('kv-card actions', () => {
  beforeEach(() => {
    useUiStore.setState({ composerDraft: null });
  });

  function renderCard(payload: string) {
    const node = renderWorkbenchFence('kv-card', payload, opts('kv-card'));
    render(<div>{node}</div>);
  }

  it('renders action buttons and click prefills the composer draft (no auto-send)', () => {
    renderCard(
      '{"风险摘要":{"集中度":"高"},"actions":[{"label":"深挖集中度","prompt":"展开分析集中度风险"}]}',
    );
    fireEvent.click(screen.getByText('深挖集中度'));
    expect(useUiStore.getState().composerDraft).toBe('展开分析集中度风险');
  });

  it('keeps single-key title detection when actions are present', () => {
    renderCard('{"风险摘要":{"集中度":"高"},"actions":[{"label":"a","prompt":"p"}]}');
    expect(screen.getByText('风险摘要')).toBeDefined();
    expect(screen.getByText('集中度')).toBeDefined();
  });

  it('ignores malformed actions and caps at 4 buttons', () => {
    renderCard(
      '{"k":"v","actions":["bare",{"label":"缺prompt"},{"prompt":"缺label"},{"label":"a1","prompt":"p1"},{"label":"a2","prompt":"p2"},{"label":"a3","prompt":"p3"},{"label":"a4","prompt":"p4"},{"label":"a5","prompt":"p5"}]}',
    );
    expect(screen.queryByText('缺prompt')).toBeNull();
    for (const label of ['a1', 'a2', 'a3', 'a4']) expect(screen.getByText(label)).toBeDefined();
    expect(screen.queryByText('a5')).toBeNull();
  });

  it('renders no action row when actions are absent', () => {
    renderCard('{"k":"v"}');
    expect(document.querySelector('button')).toBeNull();
  });
});

describe('extractConfigPatch', () => {
  it('extracts the JSON of a config-patch fence', () => {
    const md =
      '说明如下：\n\n```workbench:config-patch\n{"target":"opencode.json","patch":[{"op":"replace","path":"/model","value":"ali/r1"}]}\n```\n\n完成。';
    expect(JSON.parse(extractConfigPatch(md) as string)).toMatchObject({ target: 'opencode.json' });
  });

  it('returns the LAST fence when several are present', () => {
    const md = '```workbench:config-patch\n{"a":1}\n```\n```workbench:config-patch\n{"a":2}\n```';
    expect(JSON.parse(extractConfigPatch(md) as string)).toMatchObject({ a: 2 });
  });

  it('returns null for a still-streaming (unclosed) fence', () => {
    expect(extractConfigPatch('```workbench:config-patch\n{"a":')).toBeNull();
  });

  it('returns null when there is no fence', () => {
    expect(extractConfigPatch('plain text without fences')).toBeNull();
  });
});
