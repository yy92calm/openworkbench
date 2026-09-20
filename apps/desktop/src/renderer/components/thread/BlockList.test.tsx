import { basicCatalog } from '@a2ui/lit/v0_9';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { a2uiEngine } from '@/lib/a2ui/engine';

import { BlockList } from './BlockList';

afterEach(() => {
  a2uiEngine.dropSession('ses-1');
});

describe('BlockList', () => {
  it('feeds a running task row the live activity of its subagent', () => {
    render(
      <BlockList
        blocks={[
          {
            kind: 'tool-call',
            title: 'Visual QA for slides',
            status: 'running',
            childSessionId: 'ses_child',
          },
        ]}
        handlers={{
          subagentActivity: (id) =>
            id === 'ses_child' ? 'python3 analyze slide-03.jpg' : undefined,
        }}
      />,
    );
    expect(screen.getByText('python3 analyze slide-03.jpg')).toBeInTheDocument();
  });

  it('asks for no activity on rows that spawned no subagent', () => {
    render(
      <BlockList
        blocks={[{ kind: 'tool-call', title: 'ls -la', status: 'running' }]}
        handlers={{
          subagentActivity: () => {
            throw new Error('must not be called without a childSessionId');
          },
        }}
      />,
    );
    expect(screen.getByText('ls -la')).toBeInTheDocument();
  });

  it('mounts an A2UI surface under the agent block that owns it', () => {
    a2uiEngine.feedText(
      'ses-1',
      'p1',
      '```a2ui\n' +
        JSON.stringify({
          version: 'v0.9',
          createSurface: { surfaceId: 's1', catalogId: basicCatalog.id },
        }) +
        '\n```',
    );
    const { container } = render(
      <BlockList
        blocks={[{ kind: 'agent', markdown: 'See below.', a2uiPartKey: 'p1' }]}
        handlers={{ sessionId: 'ses-1' }}
      />,
    );
    expect(screen.getByText('See below.')).toBeInTheDocument();
    expect(container.querySelector('a2ui-surface')).not.toBeNull();
  });

  it('renders no surface without a session id (sample/static threads)', () => {
    const { container } = render(
      <BlockList
        blocks={[{ kind: 'agent', markdown: 'plain', a2uiPartKey: 'p1' }]}
        handlers={{}}
      />,
    );
    expect(container.querySelector('a2ui-surface')).toBeNull();
  });
});
