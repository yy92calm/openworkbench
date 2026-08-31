import type { ArtifactBlock, ArtifactKind } from '@workbench/shared';
import {
  Box,
  FileBarChart,
  FileCode2,
  FileText,
  Image as ImageIcon,
  NotebookPen,
  Paperclip,
  SquareArrowOutUpRight,
} from 'lucide-react';

import { cn } from '@/lib/cn';

const ICON: Record<ArtifactKind, React.ReactNode> = {
  figure: <ImageIcon size={15} />,
  script: <FileCode2 size={15} />,
  report: <FileText size={15} />,
  table: <FileBarChart size={15} />,
  notebook: <NotebookPen size={15} />,
  model: <Box size={15} />,
  data: <Paperclip size={15} />,
};

function contentPreview(content: string): string | null {
  const lines = content.split('\n');
  const preview = lines
    .slice(0, 2)
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
  return preview || null;
}

function contentSize(content: string): string {
  const bytes = new Blob([content]).size;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
}

export function ArtifactCard({
  block,
  onOpen,
}: {
  block: ArtifactBlock;
  onOpen?: (a: ArtifactBlock) => void;
}) {
  const preview = block.content ? contentPreview(block.content) : null;
  const size = block.content ? contentSize(block.content) : null;

  return (
    <div
      className={cn(
        'flex flex-col rounded-input border border-border bg-surface px-3 py-2.5 text-sm',
        onOpen && 'cursor-pointer hover:bg-surface-2',
      )}
      onClick={onOpen ? () => onOpen(block) : undefined}
      role={onOpen ? 'button' : undefined}
    >
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 text-accent">{ICON[block.artifact]}</span>
        <span className="truncate font-medium text-text">{block.filename}</span>
        <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted ring-1 ring-border">
          {block.artifact}
        </span>
        <span className="shrink-0 truncate text-xs text-muted">via {block.tool}</span>
        <div className="flex-1" />
        {onOpen && (
          <span className="flex shrink-0 items-center gap-1 rounded-input px-2 py-1 text-xs text-link">
            <SquareArrowOutUpRight size={13} /> Open
          </span>
        )}
      </div>
      {preview && (
        <div className="mt-2 rounded bg-surface-2 px-2 py-1.5 font-mono text-xs leading-5 text-muted line-clamp-2">
          {preview}
        </div>
      )}
      {(block.language || size) && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          {block.language && <span>{block.language}</span>}
          {size && <span>{size}</span>}
        </div>
      )}
    </div>
  );
}
