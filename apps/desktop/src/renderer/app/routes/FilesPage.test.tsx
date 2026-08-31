import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DirEntry } from '@/lib/artifactFile';

import { FilesPage } from './FilesPage';

afterEach(cleanup);

const listDir = vi.fn();
vi.mock('@/lib/artifactFile', () => ({
  listDir: (rel: string, root?: string) => listDir(rel, root),
}));
vi.mock('@/components/inspector/FilePreviewInspector', () => ({
  FilePreviewInspector: ({ data }: { data: { filename: string } }) => (
    <div data-testid="preview">preview:{data.filename}</div>
  ),
}));

const root: DirEntry[] = [
  { path: 'data', name: 'data', isDir: true, size: 0, modified: 2 },
  { path: 'figure.png', name: 'figure.png', isDir: false, size: 2048, modified: 3 },
  { path: 'run.ipynb', name: 'run.ipynb', isDir: false, size: 500, modified: 1 },
];
const sub: DirEntry[] = [
  { path: 'data/genes.bed', name: 'genes.bed', isDir: false, size: 120, modified: 4 },
];

describe('FilesPage', () => {
  beforeEach(() => {
    listDir.mockReset();
    listDir.mockImplementation((rel: string) => Promise.resolve(rel === 'data' ? sub : root));
  });

  it('lists workspace entries with sizes and opens a file in the previewer', async () => {
    render(<FilesPage />);
    expect(await screen.findByText('figure.png')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();

    await userEvent.click(screen.getByText('figure.png'));
    expect(screen.getByTestId('preview')).toHaveTextContent('preview:figure.png');
  });

  it('opens .ipynb files in the preview', async () => {
    render(<FilesPage />);
    await userEvent.click(await screen.findByText('run.ipynb'));
    expect(screen.getByTestId('preview')).toHaveTextContent('preview:run.ipynb');
  });

  it('navigates into a folder and back via the breadcrumb', async () => {
    render(<FilesPage />);
    await userEvent.click(await screen.findByText('data'));
    expect(await screen.findByText('genes.bed')).toBeInTheDocument();
    // The page is GLOBAL: every listing resolves in the base folder tree.
    expect(listDir).toHaveBeenCalledWith('data', 'base');

    await userEvent.click(screen.getByRole('button', { name: 'Workspace' }));
    await waitFor(() => expect(screen.getByText('figure.png')).toBeInTheDocument());
  });
});
