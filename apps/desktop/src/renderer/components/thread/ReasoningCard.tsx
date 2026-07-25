import { useState } from "react";
import { Brain, ChevronRight, Loader2 } from "lucide-react";
import type { ReasoningBlock } from "@workbench/shared";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/lib/store";

export function ReasoningCard({ block }: { block: ReasoningBlock }) {
  // Default to the global collapse setting; streaming still auto-expands so the
  // user can watch progress, and the card can always be toggled by hand.
  const expandDefault = useUiStore((s) => s.expandThreadDetails);
  const isStreaming = !!block.streaming;
  const [expanded, setExpanded] = useState(expandDefault || isStreaming);

  return (
    <div className="relative flex">
      {/* Left gradient accent line — streaming shows animated gradient */}
      <div
        className={cn(
          "w-[2px] shrink-0 rounded-full mr-3 transition-all duration-300",
          isStreaming
            ? "bg-gradient-to-b from-purple-400 via-violet-500 to-transparent bg-[length:2px_200%] animate-[gradient-shimmer_2s_linear_infinite]"
            : "bg-purple-500/20",
        )}
      />

      {/* Card body */}
      <div
        className={cn(
          "min-w-0 flex-1 rounded-lg border transition-colors",
          isStreaming
            ? "border-purple-500/20 bg-purple-500/[0.03]"
            : "border-border-soft bg-surface/60",
        )}
      >
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2/50"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <span className="flex shrink-0 items-center text-purple-400">
            {isStreaming ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Brain size={13} />
            )}
          </span>
          <span className="flex-1 truncate text-[13px] font-medium text-purple-300">
            {isStreaming ? "思考中…" : "思考过程"}
          </span>
          {isStreaming && (
            <span className="shrink-0 text-[11px] text-purple-400/60 font-mono">
              思考中
            </span>
          )}
          <ChevronRight
            size={13}
            className={cn(
              "shrink-0 text-muted transition-transform duration-150",
              expanded && "rotate-90",
            )}
          />
        </button>

        {expanded && (
          <div className="border-t border-border-soft px-3 pb-3 pt-2">
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-bg-soft/60 px-3 py-2.5 font-mono text-[12px] leading-[1.65] text-text-dim">
              {block.text}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
