import type { ReasoningBlock } from '@workbench/shared';
import { Brain, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';
import { useUiStore } from '@/lib/store';

export function ReasoningCard({ block }: { block: ReasoningBlock }) {
  // Default fold follows the global setting; streaming does not auto-expand.
  // Setting changes apply immediately (re-folds the card to the new default).
  const expandDefault = useUiStore((s) => s.expandThreadDetails);
  const isStreaming = !!block.streaming;
  const [expanded, setExpanded] = useState(expandDefault);
  useEffect(() => {
    setExpanded(expandDefault);
  }, [expandDefault]);

  return (
    <div className="relative flex">
      {/* Left gradient accent line — streaming shows animated gradient */}
      <div
        className={cn(
          'w-[2px] shrink-0 rounded-full mr-3 transition-all duration-300',
          isStreaming
            ? 'bg-gradient-to-b from-accent via-accent/50 to-transparent bg-[length:2px_200%] animate-[gradient-shimmer_2s_linear_infinite]'
            : 'bg-border',
        )}
      />

      {/* Card body */}
      <div
        className={cn(
          'min-w-0 flex-1 rounded-lg border transition-colors',
          isStreaming ? 'border-accent/20 bg-accent/[0.02]' : 'border-border-soft bg-surface/50',
        )}
      >
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2/40"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <span className="flex shrink-0 items-center text-accent/70">
            {isStreaming ? <Loader2 size={13} className="animate-spin" /> : <Brain size={13} />}
          </span>
          <span className="flex-1 truncate text-[13px] font-medium text-text-dim">
            {isStreaming ? '思考中…' : '思考过程'}
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
          <div className="border-t border-border-soft px-3 pb-3 pt-2">
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-bg-soft/60 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-text-dim">
              {block.text}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
