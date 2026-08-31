import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WORKFLOW_STARTERS, WorkflowStarters } from './WorkflowStarters';

afterEach(cleanup);

describe('WorkflowStarters', () => {
  it('renders one card per starter workflow', () => {
    render(<WorkflowStarters onPick={() => {}} />);
    for (const s of WORKFLOW_STARTERS) {
      expect(screen.getByText(s.title)).toBeInTheDocument();
    }
  });

  it('sends the starter prompt on click', async () => {
    const onPick = vi.fn();
    render(<WorkflowStarters onPick={onPick} />);
    await userEvent.click(screen.getByText(WORKFLOW_STARTERS[0].title));
    expect(onPick).toHaveBeenCalledWith(WORKFLOW_STARTERS[0].prompt);
  });
});
