import { render, screen } from '@testing-library/react';
import type { RendererManifest } from '@workbench/shared';
import { describe, expect, it } from 'vitest';

import { useInteractionStore } from '@/lib/store';

import { MarkdownViewer } from './MarkdownViewer';

function withEnabled(type: string, options?: Record<string, unknown>) {
  useInteractionStore.getState().load([{ type, options } as RendererManifest], {});
}

describe('MarkdownViewer workbench fence', () => {
  it('dispatches a workbench:kv-card fence to the renderer', () => {
    withEnabled('kv-card');
    render(<MarkdownViewer>{'```workbench:kv-card\n{"x": "y"}\n```'}</MarkdownViewer>);
    expect(screen.getByText('x')).toBeDefined();
    expect(screen.getByText('y')).toBeDefined();
  });

  it('renders a code block when the type is not enabled', () => {
    useInteractionStore.getState().load([], {});
    const { container } = render(
      <MarkdownViewer>{'```workbench:kv-card\n{"x": "y"}\n```'}</MarkdownViewer>,
    );
    // Falls back to a plain code block (language- prefix stripped).
    expect(container.querySelector('pre')).not.toBeNull();
    expect(container.textContent).toContain('{"x": "y"}');
  });

  it('dispatches only when enabled through the interaction store', () => {
    withEnabled('kv-card');
    render(<MarkdownViewer>{'```workbench:nope\n{"x": "y"}\n```'}</MarkdownViewer>);
    expect(document.querySelector('pre')).not.toBeNull();
  });
});

describe('MarkdownViewer rich fences', () => {
  it('renders a closed html fence as a preview and hides its source', () => {
    const { container } = render(
      <MarkdownViewer>{'intro\n\n```html\n<p>hi</p>\n```\n\noutro'}</MarkdownViewer>,
    );
    expect(container.querySelector('iframe')).not.toBeNull();
    expect(screen.getByText('intro')).toBeDefined();
    expect(screen.getByText('outro')).toBeDefined();
    // Fence markers and raw source never appear in the thread text.
    expect(screen.queryByText(/```html/)).toBeNull();
    expect(screen.queryByText('<p>hi</p>')).toBeNull();
  });

  it('keeps non-rich fences as plain code blocks', () => {
    const { container } = render(<MarkdownViewer>{'```js\nconst a = 1;\n```'}</MarkdownViewer>);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('pre')).not.toBeNull();
    expect(container.textContent).toContain('const a = 1;');
  });

  it('hides an unclosed fence while streaming and shows the pending card', () => {
    const { container } = render(
      <MarkdownViewer streaming>{'text\n\n```html\n<p>half'}</MarkdownViewer>,
    );
    expect(screen.getByText('text')).toBeDefined();
    expect(screen.getByText('正在生成预览…')).toBeDefined();
    expect(container.querySelector('pre')).toBeNull();
    expect(screen.queryByText('<p>half')).toBeNull();
  });

  it('renders rich fences in the document variant too (docs/20260909-01)', () => {
    const { container } = render(
      <MarkdownViewer variant="document">{'```html\n<p>hi</p>\n```'}</MarkdownViewer>,
    );
    expect(container.querySelector('iframe')).not.toBeNull();
  });

  it('renders a closed csv fence as a mini table (docs/20260909-03)', () => {
    render(<MarkdownViewer>{'```csv\nname,val\nalpha,1\nbeta,2\n```'}</MarkdownViewer>);
    expect(screen.getByText('name')).toBeDefined();
    expect(screen.getByText('alpha')).toBeDefined();
  });

  it('degrades an invalid csv fence back to a code block', () => {
    // A single undelimited line parses to zero rows -> code block fallback.
    const { container } = render(
      <MarkdownViewer>{'```csv\njust one line no commas\n```'}</MarkdownViewer>,
    );
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('pre')).not.toBeNull();
  });

  it('renders an echarts fence as a live chart in the document variant', () => {
    // echarts itself is lazy-loaded; the container div appearing (and no
    // <pre>) is the observable contract here.
    const { container } = render(
      <MarkdownViewer variant="document">
        {'```echarts\n{"xAxis":{},"yAxis":{}}\n```'}
      </MarkdownViewer>,
    );
    expect(container.querySelector('pre')).toBeNull();
  });
});
