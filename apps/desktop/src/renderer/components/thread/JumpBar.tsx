import type { ThreadBlock } from '@workbench/shared';
import { useState } from 'react';

import { cn } from '@/lib/cn';

interface JumpPoint {
  index: number;
  preview: string;
}

/**
 * Floating mini navigation bar for long conversations.
 * Each dot corresponds to a user message; hover shows preview, click scrolls to it.
 * Only visible when there are >= 3 user messages.
 */
export function JumpBar({ blocks }: { blocks: ThreadBlock[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const points: JumpPoint[] = blocks
    .map((b, i) => ({ block: b, index: i }))
    .filter(({ block }) => block.kind === 'user')
    .map(({ index }) => {
      const block = blocks[index];
      const text = block.kind === 'user' ? block.text : '';
      return {
        index,
        preview: text.length > 40 ? text.slice(0, 40) + '...' : text,
      };
    });

  if (points.length < 3) return null;

  const scrollToBlock = (blockIndex: number) => {
    const el = document.getElementById(`block-${blockIndex}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div className="sticky right-0 top-1/3 z-sticky ml-auto flex w-6 shrink-0 flex-col items-center gap-1.5">
      {points.map((point, i) => (
        <div
          key={point.index}
          className="group/jump relative flex items-center"
          onMouseEnter={() => setHoveredIdx(i)}
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {/* Preview tooltip — appears to the left */}
          {hoveredIdx === i && (
            <div className="pointer-events-none absolute right-full mr-3 whitespace-nowrap rounded-input border border-border-soft bg-surface px-2.5 py-1.5 text-[11px] text-text shadow-card">
              <div className="max-w-[240px] truncate">{point.preview}</div>
            </div>
          )}
          <button
            onClick={() => scrollToBlock(point.index)}
            className={cn(
              'h-2 w-2 rounded-full border transition-all',
              hoveredIdx === i
                ? 'scale-125 border-accent bg-accent'
                : 'border-muted/40 bg-muted/20 hover:border-accent/60 hover:bg-accent/30',
            )}
            title={point.preview}
          />
        </div>
      ))}
    </div>
  );
}
