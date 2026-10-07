import type { MemoryRecallBlock } from '@workbench/shared';
import { BookOpen, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';
import { useUiStore } from '@/lib/store';

export function MemoryRecallCard({
  block,
  onMemoryOpen,
}: {
  block: MemoryRecallBlock;
  onMemoryOpen?: (id: string) => void;
}) {
  const expandDefault = useUiStore((s) => s.expandThreadDetails);
  const [expanded, setExpanded] = useState(expandDefault);
  useEffect(() => {
    setExpanded(expandDefault);
  }, [expandDefault]);

  const count = block.memories.length;

  return (
    <div className="rounded-lg border border-border-soft bg-surface/40">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2/40"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <BookOpen size={13} className="shrink-0 text-accent/70" />
        <span className="flex-1 truncate text-text-dim">
          已注入 {count} 条相关记忆
        </span>
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
          {block.memories.map((m) => (
            <button
              key={m.id}
              type="button"
              className="flex flex-col gap-0.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-surface-2/60"
              onClick={() => onMemoryOpen?.(m.id)}
            >
              <span className="text-[12px] font-medium text-text">
                {m.title}
              </span>
              {m.summary && (
                <span className="text-[11px] leading-snug text-text-dim line-clamp-2">
                  {m.summary}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
