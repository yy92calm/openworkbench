import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FilePreviewInspector as FilePreviewInspectorT } from '@workbench/shared';
import { describe, expect, it, vi } from 'vitest';

import { FilePreviewInspector, PreviewError } from './FilePreviewInspector';

// Markdown/JSON tests below carry inline `content`, so they never hit
// readArtifact — this mock only feeds the binary-file test.
vi.mock('@/lib/artifactFile', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/artifactFile')>();
  return {
    ...mod,
    readArtifact: vi.fn(async () => ({
      path: 'data/blob.bin',
      mime: 'application/octet-stream',
      encoding: 'base64',
      data: 'AAEC',
      size: 3,
    })),
    previewUrl: vi.fn(async () => null),
  };
});

const md: FilePreviewInspectorT = {
  variant: 'file',
  path: 'notes/report.md',
  filename: 'report.md',
  artifact: 'report',
  content: '# Findings\n\nDose–response holds. `p < 0.01`.',
};

describe('FilePreviewInspector — markdown', () => {
  it('renders markdown as a formatted document by default', async () => {
    render(<FilePreviewInspector data={md} onClose={() => {}} />);
    // The heading is real document markup, not raw "# Findings" text.
    expect(await screen.findByRole('heading', { name: 'Findings' })).toBeInTheDocument();
    expect(screen.queryByText('# Findings')).not.toBeInTheDocument();
  });

  it('toggles to the raw source under the Code tab', async () => {
    render(<FilePreviewInspector data={md} onClose={() => {}} />);
    await screen.findByRole('heading', { name: 'Findings' });
    await userEvent.click(screen.getByRole('button', { name: /Code/ }));
    expect(screen.getByText(/# Findings/)).toBeInTheDocument();
  });

  it('shows the newly opened file, not the previous one (no stale bleed)', async () => {
    // The same inspector instance is reused across files; opening a second
    // file with its own inline content must replace the first, not keep it.
    const a: FilePreviewInspectorT = { ...md, path: 'a.md', filename: 'a.md', content: '# Alpha' };
    const b: FilePreviewInspectorT = { ...md, path: 'b.md', filename: 'b.md', content: '# Beta' };
    const { rerender } = render(<FilePreviewInspector data={a} onClose={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeInTheDocument();

    rerender(<FilePreviewInspector data={b} onClose={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Beta' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Alpha' })).not.toBeInTheDocument();
  });
});

describe('FilePreviewInspector — binary file behind a text preview', () => {
  it("says the file is binary instead of the misleading 'desktop app' note", async () => {
    // A text-kind preview whose read comes back base64 (genuinely binary
    // bytes) must say so — not claim the preview needs the desktop app.
    const bin: FilePreviewInspectorT = {
      variant: 'file',
      path: 'data/blob.bin',
      filename: 'blob.bin',
      artifact: 'data',
    };
    render(<FilePreviewInspector data={bin} onClose={() => {}} />);
    expect(await screen.findByText(/binary and has no preview/)).toBeInTheDocument();
    expect(screen.queryByText(/available in the desktop app/)).not.toBeInTheDocument();
  });
});

const jsonData: FilePreviewInspectorT = {
  variant: 'file',
  path: 'config/settings.json',
  filename: 'settings.json',
  artifact: 'data',
  content: JSON.stringify({ name: 'test', version: 2, metrics: [1, 2, 3] }, null, 2),
};

describe('FilePreviewInspector — json', () => {
  it('renders a collapsible tree view by default', async () => {
    render(<FilePreviewInspector data={jsonData} onClose={() => {}} />);
    expect(await screen.findByText(/name/)).toBeInTheDocument();
    expect(await screen.findByText(/test/)).toBeInTheDocument();
  });

  it('toggles to the raw JSON source under the Code tab', async () => {
    render(<FilePreviewInspector data={jsonData} onClose={() => {}} />);
    await screen.findByText(/name/);
    await userEvent.click(screen.getByRole('button', { name: /Code/ }));
    expect(screen.getByText(/"name"/)).toBeInTheDocument();
  });

  it('falls back to CodeViewer when JSON is invalid', async () => {
    const bad: FilePreviewInspectorT = {
      ...jsonData,
      content: 'not valid json',
    };
    render(<FilePreviewInspector data={bad} onClose={() => {}} />);
    expect(await screen.findByText(/not valid json/)).toBeInTheDocument();
  });
});

describe('FilePreviewInspector — audio/video', () => {
  it('shows a fallback note for audio when no file server URL is available', async () => {
    const audio: FilePreviewInspectorT = {
      variant: 'file',
      path: 'media/song.mp3',
      filename: 'song.mp3',
      artifact: 'data',
    };
    render(<FilePreviewInspector data={audio} onClose={() => {}} />);
    expect(await screen.findByText(/available in the desktop app/)).toBeInTheDocument();
  });

  it('shows a fallback note for video when no file server URL is available', async () => {
    const video: FilePreviewInspectorT = {
      variant: 'file',
      path: 'media/clip.mp4',
      filename: 'clip.mp4',
      artifact: 'data',
    };
    render(<FilePreviewInspector data={video} onClose={() => {}} />);
    expect(await screen.findByText(/available in the desktop app/)).toBeInTheDocument();
  });
});

describe('PreviewError', () => {
  it('shows a helpful card with Open-externally for a too-large file', async () => {
    const onOpen = vi.fn();
    render(<PreviewError error="file too large to preview (>25 MB)" onOpenExternally={onOpen} />);
    expect(screen.getByText(/too large to preview/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Open externally/ }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('renders other errors as a plain line, no card', () => {
    render(
      <PreviewError error="Preview is available in the desktop app." onOpenExternally={() => {}} />,
    );
    expect(screen.getByText(/available in the desktop app/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open externally/ })).not.toBeInTheDocument();
  });
});
