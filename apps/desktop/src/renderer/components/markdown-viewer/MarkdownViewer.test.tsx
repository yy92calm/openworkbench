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
