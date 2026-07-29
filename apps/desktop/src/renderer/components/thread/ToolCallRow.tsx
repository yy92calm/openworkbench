import { useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Clock, Loader2, ShieldQuestion, X, ChevronDown } from "lucide-react";
import type { ToolCallBlock, ToolCallStatus } from "@workbench/shared";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/lib/store";

const STATUS: Record<
  ToolCallStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  pending: { label: "等待中", icon: <Clock size={13} />, className: "text-muted" },
  running: { label: "运行中", icon: <Loader2 size={13} className="animate-spin" />, className: "text-accent" },
  "waiting-approval": { label: "待审批", icon: <ShieldQuestion size={14} />, className: "text-warn" },
  success: { label: "成功", icon: <Check size={13} />, className: "text-ok" },
  warning: { label: "警告", icon: <AlertTriangle size={14} />, className: "text-warn" },
  failed: { label: "失败", icon: <X size={14} />, className: "text-error" },
};

/** Tool call card with status icon, expandable body, error display. */
export function ToolCallRow({ block, activity }: { block: ToolCallBlock; activity?: string }) {
  const s = STATUS[block.status];
  const expandDefault = useUiStore((st) => st.expandThreadDetails);
  const [expanded, setExpanded] = useState(expandDefault);
  useEffect(() => {
    setExpanded(expandDefault);
  }, [expandDefault]);

  const isRunning = block.status === "running";
  const isError = block.status === "failed" || block.status === "warning";
  const isWaiting = block.status === "waiting-approval";
  const isDone = block.status === "success" || block.status === "failed" || block.status === "warning";

  // Error display: show first line, expand for full error
  const errorOutput = isError && block.outputSummary ? block.outputSummary : null;
  const errorPreview = errorOutput
    ? errorOutput.split("\n")[0].replace(/^error:\s*/i, "").slice(0, 140)
    : null;
  const errorLong = errorOutput && (errorOutput.length > 140 || errorOutput.includes("\n"));

  return (
    <div
      data-status={block.status}
      className={cn(
        "rounded-lg border transition-colors",
        isRunning
          ? "border-accent/25 bg-surface"
          : isError
            ? "border-error/20 bg-surface"
            : isWaiting
              ? "border-warn/20 bg-surface"
              : "border-border-soft bg-surface/50",
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2/40"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className={cn("flex shrink-0 items-center", s.className)} aria-label={s.label}>
          {s.icon}
        </span>
        <span className={cn("flex-1 truncate text-[13px] font-mono", isRunning ? "text-text" : "text-text-dim")}>
          {block.title}
        </span>
        {block.meta && <span className="shrink-0 text-[11px] text-muted">{block.meta}</span>}
        {isDone && block.duration && (
          <span className="shrink-0 text-[11px] text-fg-faint">{block.duration}s</span>
        )}
        <ChevronRight
          size={13}
          className={cn("shrink-0 text-muted transition-transform duration-150", expanded && "rotate-90")}
        />
      </button>

      {/* Error preview when collapsed */}
      {!expanded && errorPreview && (
        <div className="flex items-center gap-1.5 px-3 pb-2 pl-[34px]">
          <AlertTriangle size={11} className="shrink-0 text-error" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-error">{errorPreview}</span>
          {errorLong && <ChevronDown size={11} className="shrink-0 text-muted" />}
        </div>
      )}

      {/* Input summary when collapsed */}
      {!expanded && !errorPreview && block.inputSummary && (
        <div className="truncate px-3 pb-2 pl-[34px] text-[12px] text-muted">{block.inputSummary}</div>
      )}

      {expanded && (
        <div className="border-t border-border-soft px-3 pb-3 pt-2">
          {block.inputSummary && (
            <div className="mb-2">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Input</div>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-bg-soft px-3 py-2 font-mono text-[12px] leading-5 text-text-dim">
                {block.inputSummary}
              </pre>
            </div>
          )}
          {block.outputSummary && (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Output</div>
              <pre
                className={cn(
                  "max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded-md px-3 py-2 font-mono text-[12px] leading-5",
                  isError ? "bg-error/8 text-error" : "bg-bg-soft text-text-dim",
                )}
              >
                {block.outputSummary}
              </pre>
            </div>
          )}
        </div>
      )}

      {activity && isRunning && (
        <div className="flex items-center gap-2 border-t border-border-soft px-3 py-1.5 text-[12px]">
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
          <span className="min-w-0 flex-1 truncate font-mono text-muted">{activity}</span>
        </div>
      )}
    </div>
  );
}