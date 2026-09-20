import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ToolCallStatus } from '@workbench/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { ToolCallRow } from './ToolCallRow';

afterEach(cleanup);

// Status badge labels moved to Chinese (see STATUS table in ToolCallRow.tsx);
// the badge's accessible name now lives on the wrapping <span aria-label>.
const STATUSES: [ToolCallStatus, string][] = [
  ['pending', '等待中'],
  ['running', '运行中'],
  ['waiting-approval', '待审批'],
  ['success', '成功'],
  ['warning', '警告'],
  ['failed', '失败'],
];

describe('ToolCallRow', () => {
  it.each(STATUSES)('renders the %s status badge', (status, label) => {
    const { container } = render(
      <ToolCallRow block={{ kind: 'tool-call', title: 'Run tool', status }} />,
    );
    expect(container.querySelector(`[data-status="${status}"]`)).toBeInTheDocument();
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it('shows the right-aligned meta', () => {
    render(
      <ToolCallRow
        block={{
          kind: 'tool-call',
          title: 'Dispatch',
          status: 'success',
          meta: '142 lines of output',
        }}
      />,
    );
    expect(screen.getByText('142 lines of output')).toBeInTheDocument();
  });

  it("shows the subagent's live activity under a running task row", () => {
    render(
      <ToolCallRow
        block={{ kind: 'tool-call', title: 'Visual QA for slides', status: 'running' }}
        activity="python3 analyze slide-03.jpg"
      />,
    );
    expect(screen.getByText('python3 analyze slide-03.jpg')).toBeInTheDocument();
  });

  it('hides the activity line once the task has settled', () => {
    render(
      <ToolCallRow
        block={{ kind: 'tool-call', title: 'Visual QA for slides', status: 'success' }}
        activity="python3 analyze slide-03.jpg"
      />,
    );
    expect(screen.queryByText('python3 analyze slide-03.jpg')).not.toBeInTheDocument();
  });

  it('shows the output of a user-run shell command when expanded', async () => {
    render(
      <ToolCallRow
        block={{
          kind: 'tool-call',
          title: 'pwd',
          status: 'success',
          outputSummary: '/ws/2026-07-04-1030',
        }}
      />,
    );
    // The collapsed row only shows input/error previews; output lives in the
    // expandable body (Output block), so expand the row to reveal it.
    await userEvent.click(screen.getByRole('button', { name: /pwd/ }));
    expect(screen.getByText('/ws/2026-07-04-1030')).toBeInTheDocument();
  });
});

describe('ToolCallRow ANSI cleanup', () => {
  it('strips escape sequences from the error preview of a failed tool', () => {
    render(
      <ToolCallRow
        block={{
          kind: 'tool-call',
          title: 'flake',
          status: 'failed',
          outputSummary: '\x1b[31merror: boom\x1b[0m',
        }}
      />,
    );
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.queryByText((t) => t.includes('\u001b'))).not.toBeInTheDocument();
  });

  it('strips escape sequences from expanded output while keeping plain text', async () => {
    render(
      <ToolCallRow
        block={{
          kind: 'tool-call',
          title: 'colored',
          status: 'success',
          outputSummary: '\x1b[32mok\x1b[0m · plain',
        }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /colored/ }));
    expect(screen.getByText('ok · plain')).toBeInTheDocument();
    expect(screen.queryByText((t) => t.includes('\u001b'))).not.toBeInTheDocument();
  });
});
