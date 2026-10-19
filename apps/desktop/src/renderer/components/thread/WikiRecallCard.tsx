import type { WikiRecallBlock } from '@workbench/shared';
import { ChevronRight, Library } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';
import { useUiStore } from '@/lib/store';

export function WikiRecallCard({
  block,
  onPageOpen,
}: {
  block: WikiRecallBlock;
  onPageOpen?: (slug: string) => void;
}) {
  const expandDefault = useUiStore((s) => s.expandThreadDetails);
  const [expanded, setExpanded] = useState(expandDefault);
  useEffect(() => {
    setExpanded(expandDefault);
  }, [expandDefault]);

  const count = block.pages.length;

  return (
    <div className="rounded-lg border border-border-soft bg-surface/40">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2/40"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <Library size={13} className="shrink-0 text-accent/70" />
        <span className="flex-1 truncate text-text-dim">已注入 {count} 个 Wiki 页面</span>
        <ChevronRight
          size={13}
          className={cn(
            'shrink-0 text-muted transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />
      </button>
      {expanded && (
        <div className="flex flex-col gap-1 border-t border-border-soft px-3 py-2">
          {block.pages.map((page) => (
            <button
              key={page.slug}
              type="button"
              className="flex flex-col gap-0.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-surface-2/60"
              onClick={() => onPageOpen?.(page.slug)}
            >
              <span className="text-[12px] font-medium text-text">{page.title}</span>
              {page.summary && (
                <span className="text-[11px] leading-snug text-text-dim line-clamp-2">
                  {page.summary}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
