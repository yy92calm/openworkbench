import { useEffect, useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import type { ToolCallBlock } from "@workbench/shared";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/lib/store";

export function ShellCard({ block }: { block: ToolCallBlock }) {
  const expandDefault = useUiStore((s) => s.expandThreadDetails);
  const [expanded, setExpanded] = useState(expandDefault);
  useEffect(() => {
    setExpanded(expandDefault);
  }, [expandDefault]);
  const isSuccess = block.status === "success";
  const isFailed = block.status === "failed";
  const isRunning = block.status === "running";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border font-mono transition-colors",
        isFailed
          ? "border-error/30 bg-error/5"
          : isSuccess
            ? "border-ok/20 bg-surface/60"
            : "border-border-soft bg-surface/60",
      )}
    >
      {/* Terminal title bar */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b border-border-soft/60"
      >
        {/* Traffic light dots */}
        <span className="h-2.5 w-2.5 rounded-full bg-error/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-warn/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-ok/60" />
        <span className="flex-1 truncate pl-1 text-[12px] text-text-dim">
          <span className="text-muted select-none">$ </span>
          {block.shellCommand ?? block.title}
        </span>
        {/* Status indicator */}
        {isSuccess && <Check size={12} className="shrink-0 text-ok" />}
        {isFailed && <X size={12} className="shrink-0 text-error" />}
        {isRunning && (
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
        )}
        <ChevronRight
          size={12}
          className={cn(
            "shrink-0 text-muted transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
      </div>

      {/* Clickable header to toggle expand */}
      <button
        type="button"
        className="flex w-full items-center px-3 py-1.5 text-left transition-colors hover:bg-surface-2/50"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className={cn(
          "flex-1 truncate text-[13px]",
          isFailed ? "text-error/80" : "text-text",
        )}>
          {block.inputSummary || (block.shellCommand ?? block.title)}
        </span>
        {block.meta && (
          <span className="shrink-0 pl-2 text-[11px] text-muted">{block.meta}</span>
        )}
      </button>

      {/* Expanded output */}
      {expanded && block.outputSummary && (
        <div className="px-3 pb-3 pt-1">
          <pre
            className={cn(
              "max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded-md px-3 py-2.5 text-[12px] leading-5",
              isFailed
                ? "bg-error/10 text-error"
                : "bg-bg text-text-dim",
            )}
          >
            {block.outputSummary}
          </pre>
        </div>
      )}

      {/* Success gradient bar */}
      {isSuccess && (
        <div className="h-[2px] bg-gradient-to-r from-ok/30 via-ok/10 to-transparent" />
      )}
    </div>
  );
}
