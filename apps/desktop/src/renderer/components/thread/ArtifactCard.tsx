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
import { useEffect, useState } from 'react';

import { readArtifact } from '@/lib/artifactFile';
import { artifactPreviewPlan } from '@/lib/artifacts';
import { cn } from '@/lib/cn';

import { MiniTable } from './MiniTable';

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

/** Rich inline previews (docs/20260909-01-artifact-rich-cards.md): image / svg
 *  thumbnails, csv mini table, live html iframe. Every failure mode — read
 *  error, parse error, oversize — silently degrades to the plain text card.
 *  Lazy: the file is only read once the card mounts, and `readArtifact`'s
 *  server-side PREVIEW_CAP bounds the read. */
function ArtifactPreview({ block }: { block: ArtifactBlock }) {
  const plan = artifactPreviewPlan(block);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(
    plan?.useInlineContent && typeof block.content === 'string' ? block.content : null,
  );

  useEffect(() => {
    if (!plan) return;
    if (text !== null) return; // inline content already available
    let cancelled = false;
    void readArtifact(block.path).then((file) => {
      if (cancelled || !file) return;
      if (file.encoding === 'base64') {
        // Bound the data URI: a huge image would stall the thread list.
        if (file.data.length <= 4 * 1024 * 1024)
          setImageSrc(`data:image/${block.filename.split('.').pop()};base64,${file.data}`);
      } else {
        setText(file.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [block.path, block.filename, plan, text]);

  if (!plan) return null;
  if (plan.kind === 'image' && imageSrc) {
    return (
      <div className="mt-2 overflow-hidden rounded bg-surface-2">
        <img
          src={imageSrc}
          alt={block.filename}
          className="max-h-56 w-full object-contain"
          loading="lazy"
        />
      </div>
    );
  }
  if (plan.kind === 'svg' && text !== null) {
    const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
    return (
      <div className="mt-2 overflow-hidden rounded bg-white p-3">
        <img
          src={uri}
          alt={block.filename}
          className="mx-auto block max-h-56 max-w-full"
          loading="lazy"
        />
      </div>
    );
  }
  if (plan.kind === 'table' && text !== null) {
    return (
      <div className="mt-2">
        <MiniTable filename={block.filename} text={text} />
      </div>
    );
  }
  if (plan.kind === 'html' && text !== null) {
    return (
      <div className="mt-2 overflow-hidden rounded border border-border">
        <iframe
          title={`${block.filename} preview`}
          sandbox="allow-scripts"
          srcDoc={text}
          className="h-[320px] w-full border-0 bg-white"
          loading="lazy"
        />
      </div>
    );
  }
  return null; // still loading, or degraded (oversize / parse failure)
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
  const hasRichPreview = artifactPreviewPlan(block) !== null;

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
      {/* Rich preview replaces the text snippet for figure/table/html cards;
        the snippet stays for everything else (scripts, reports, data). */}
      {hasRichPreview ? (
        <ArtifactPreview block={block} />
      ) : (
        preview && (
          <div className="mt-2 rounded bg-surface-2 px-2 py-1.5 font-mono text-xs leading-5 text-muted line-clamp-2">
            {preview}
          </div>
        )
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
