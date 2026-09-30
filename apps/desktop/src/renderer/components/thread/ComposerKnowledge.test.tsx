import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Composer } from './Composer';

// The knowledge body is fetched over the desktop bridge when an entry is picked.
vi.mock('@/lib/tauri', () => ({
  isTauri: true,
  addFilesToWorkspace: vi.fn(async () => []),
  addTextToWorkspace: vi.fn(async () => 'pasted.txt'),
  knowledgeGet: vi.fn(async (id: string) => ({
    id,
    title: '轮动打分口径',
    summary: '复盘口径',
    category: '',
    tags: [],
    created: '',
    updated: '',
    content: '总分 = 0.4*ret60 + 0.6*rs60\n',
  })),
}));

const ENTRIES = [{ id: 'kb-1', title: '轮动打分口径', summary: '复盘口径' }];

describe('Composer knowledge references', () => {
  it('picks an entry into a chip and sends its body as a marked reference paragraph', async () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} knowledgeSuggestions={ENTRIES} />);
    const input = screen.getByLabelText<HTMLTextAreaElement>('有什么想问的？');

    fireEvent.change(input, { target: { value: '看看 @轮动' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' }); // pick the entry, not send

    // The "@query" is consumed and the entry becomes a removable chip.
    await waitFor(() => expect(screen.getByLabelText('移除引用 轮动打分口径')).toBeTruthy());
    expect(input.value).toBe('看看 ');

    fireEvent.change(input, { target: { value: '看看这个口径' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledTimes(1);
    const sent = onSend.mock.calls[0][0] as string;
    expect(sent).toContain('看看这个口径');
    expect(sent).toContain('Referenced knowledge entries');
    expect(sent).toContain('## 轮动打分口径');
    expect(sent).toContain('总分 = 0.4*ret60 + 0.6*rs60');
    // The user's own words come first — the reference material follows.
    expect(sent.indexOf('看看这个口径')).toBeLessThan(sent.indexOf('Referenced knowledge'));
    expect(screen.queryByLabelText('移除引用 轮动打分口径')).toBeNull();
  });

  it('a chip can be removed without sending', async () => {
    render(<Composer onSend={vi.fn()} knowledgeSuggestions={ENTRIES} />);
    const input = screen.getByLabelText('有什么想问的？');
    fireEvent.change(input, { target: { value: 'see @轮动' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByLabelText('移除引用 轮动打分口径')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('移除引用 轮动打分口径'));
    expect(screen.queryByLabelText('移除引用 轮动打分口径')).toBeNull();
  });

  it('lists workspace files and knowledge entries in one popup, files first', () => {
    render(
      <Composer onSend={vi.fn()} fileSuggestions={['data.csv']} knowledgeSuggestions={ENTRIES} />,
    );
    const input = screen.getByLabelText('有什么想问的？');
    fireEvent.change(input, { target: { value: 'see @' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain('data.csv');
    expect(options[1].textContent).toContain('轮动打分口径');
  });
});
