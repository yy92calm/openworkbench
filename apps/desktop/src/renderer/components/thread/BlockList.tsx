import { useMemo, useState } from "react";
import { BookOpen, Check, ChevronRight, Code, Cpu, GitBranch, Terminal, X } from "lucide-react";
import type { ArtifactBlock, FigureAnnotation, ThreadBlock, ToolCallBlock } from "@workbench/shared";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/lib/store";
import { AgentMessage, DataTable, RunningJobsOverlay, StatusLine, UserMessage } from "./atoms";
import { ToolCallRow } from "./ToolCallRow";
import { StepSummaryRow } from "./StepSummaryRow";
import { FigureBlock } from "./FigureBlock";
import { ArtifactCard } from "./ArtifactCard";
import { TurnDivider } from "./TurnDivider";
import { ReasoningCard } from "./ReasoningCard";
import { ShellCard } from "./ShellCard";

export interface BlockHandlers {
  /** Open an artifact in the inspector (live session). */
  onArtifactOpen?: (a: ArtifactBlock) => void;
  /** Forward a figure annotation to the agent (live session). */
  onFigureComment?: (annotation: FigureAnnotation, figureTitle: string) => void;
  /** Live one-line activity of the subagent a task tool spawned (live session). */
  subagentActivity?: (childSessionId: string) => string | undefined;
  /** User clicked edit on a user message. */
  onUserMessageEdit?: (text: string) => void;
}

/** A renderable item: either a single block or a group of consecutive tool-call blocks. */
type RenderItem =
  | { type: "block"; block: ThreadBlock; key: number }
  | { type: "tool-group"; blocks: ThreadBlock[]; key: number };

/** Pre-process blocks: group consecutive tool-calls (>=3) into collapsible groups. */
function prepareItems(blocks: ThreadBlock[]): RenderItem[] {
  const items: RenderItem[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    // Collect consecutive tool-call blocks
    if (b.kind === "tool-call") {
      const start = i;
      while (i < blocks.length && blocks[i].kind === "tool-call") i++;
      const count = i - start;
      if (count >= 3) {
        items.push({ type: "tool-group", blocks: blocks.slice(start, i), key: start });
      } else {
        for (let j = start; j < i; j++) {
          items.push({ type: "block", block: blocks[j], key: j });
        }
      }
    } else {
      items.push({ type: "block", block: b, key: i });
      i++;
    }
  }
  return items;
}

/** Spacing rhythm: different block transitions need different visual gaps. */
function spacingBefore(kind: ThreadBlock["kind"]): string {
  switch (kind) {
    case "user":
      return "mt-5";
    case "agent":
      return "mt-4";
    case "tool-call":
    case "step-summary":
      return "mt-1.5";
    case "reasoning":
      return "mt-3";
    case "turn-divider":
      return "mt-2";
    default:
      return "mt-2";
  }
}

export function renderBlock(block: ThreadBlock, i: number, handlers?: BlockHandlers, prevKind?: ThreadBlock["kind"]) {
  const sp = spacingBefore(block.kind);
  switch (block.kind) {
    case "turn-divider":
      return <TurnDivider key={i} block={block} />;
    case "user":
      return (
        <div key={i} id={`block-${i}`} className={prevKind ? sp : ""}>
          <UserMessage
            block={block}
            onEdit={handlers?.onUserMessageEdit}
          />
        </div>
      );
    case "agent":
      return (
        <div key={i} className={prevKind ? sp : ""}>
          <AgentMessage
            markdown={block.markdown}
            timestamp={block.timestamp}
            onOpenArtifact={handlers?.onArtifactOpen}
          />
        </div>
      );
    case "reasoning":
      return <div key={i} className={prevKind ? sp : ""}><ReasoningCard block={block} /></div>;
    case "step-summary":
      return <div key={i} className={prevKind ? sp : ""}><StepSummaryRow block={block} /></div>;
    case "tool-call":
      // Shell commands get their own card
      if (block.shellCommand) {
        return <div key={i} className={prevKind ? sp : ""}><ShellCard block={block} /></div>;
      }
      return (
        <div key={i} className={prevKind ? sp : ""}>
          <ToolCallRow
            block={block}
            activity={
              block.childSessionId ? handlers?.subagentActivity?.(block.childSessionId) : undefined
            }
          />
        </div>
      );
    case "table":
      return <div key={i} className={prevKind ? sp : ""}><DataTable block={block} /></div>;
    case "figure":
      return <div key={i} className={prevKind ? sp : ""}><FigureBlock block={block} onComment={handlers?.onFigureComment} /></div>;
    case "artifact":
      return <div key={i} className={prevKind ? sp : ""}><ArtifactCard block={block} onOpen={handlers?.onArtifactOpen} /></div>;
    case "running-jobs":
      return <div key={i} className={prevKind ? sp : ""}><RunningJobsOverlay block={block} /></div>;
    case "status-line":
      return <div key={i} className={prevKind ? sp : ""}><StatusLine block={block} /></div>;
  }
}

export function BlockList({
  blocks,
  handlers,
}: {
  blocks: ThreadBlock[];
  handlers?: BlockHandlers;
}) {
  const items = useMemo(() => prepareItems(blocks), [blocks]);

  return (
    <>
      {items.map((item, idx) => {
        if (item.type === "block") {
          const prevKind = idx > 0
            ? (items[idx - 1].type === "tool-group" ? "tool-call" as const : (items[idx - 1] as { type: "block"; block: ThreadBlock }).block.kind)
            : undefined;
          return renderBlock(item.block, item.key, handlers, prevKind);
        }
        // Tool group
        const prevKind = idx > 0
          ? (items[idx - 1].type === "tool-group" ? "tool-call" as const : (items[idx - 1] as { type: "block"; block: ThreadBlock }).block.kind)
          : undefined;
        return (
          <div key={item.key} className={prevKind ? spacingBefore("tool-call") : ""}>
            <ToolGroup blocks={item.blocks} handlers={handlers} />
          </div>
        );
      })}
    </>
  );
}

/** Tool categories and their identifying tool name patterns. */
const TOOL_CATEGORIES = [
  { id: "explore", label: "Explore", icon: <BookOpen size={13} />, color: "text-link", tools: ["read", "ls", "grep", "glob", "web_fetch", "search"] },
  { id: "modify", label: "Modify", icon: <Code size={13} />, color: "text-ok", tools: ["write", "edit", "move", "delete", "rename"] },
  { id: "delegate", label: "Delegate", icon: <GitBranch size={13} />, color: "text-accent", tools: ["task", "run_skill", "explore", "research", "review"] },
  { id: "shell", label: "Shell", icon: <Terminal size={13} />, color: "text-warn", tools: ["bash", "shell", "terminal"] },
  { id: "other", label: "Tools", icon: <Cpu size={13} />, color: "text-muted", tools: [] },
] as const;

function categoryOf(title: string): typeof TOOL_CATEGORIES[number] {
  const lower = title.toLowerCase();
  for (const cat of TOOL_CATEGORIES) {
    if (cat.tools.some((t) => lower.startsWith(t) || lower.includes(t))) return cat;
  }
  return TOOL_CATEGORIES[TOOL_CATEGORIES.length - 1];
}

function ToolGroup({
  blocks,
  handlers,
}: {
  blocks: ThreadBlock[];
  handlers?: BlockHandlers;
}) {
  const [expanded, setExpanded] = useState(useUiStore((s) => s.expandThreadDetails));
  const toolBlocks = blocks.filter((b): b is ToolCallBlock => b.kind === "tool-call");
  const count = toolBlocks.length;
  const done = toolBlocks.filter((b) => b.status === "success" || b.status === "failed" || b.status === "warning").length;
  const failed = toolBlocks.filter((b) => b.status === "failed").length;
  const allDone = done === count;

  // Categorize by most common category
  const cats = toolBlocks.map((b) => categoryOf(b.title));
  const primaryCat = cats.sort((a, b) => cats.filter((c) => c === a).length - cats.filter((c) => c === b).length).pop() ?? TOOL_CATEGORIES[TOOL_CATEGORIES.length - 1];
  const catCounts = new Map<string, number>();
  for (const c of cats) {
    catCounts.set(c.id, (catCounts.get(c.id) ?? 0) + 1);
  }
  const summary = [...catCounts.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${n} ${TOOL_CATEGORIES.find((c) => c.id === id)?.label ?? id}`)
    .join(", ");

  return (
    <div className="rounded-lg border border-border-soft bg-surface/40">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2/50"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-150", expanded && "rotate-90")}
        />
        <span className={cn("flex shrink-0 items-center", primaryCat.color)}>{primaryCat.icon}</span>
        {allDone && !failed && <Check size={13} className="shrink-0 text-ok" />}
        {failed > 0 && <X size={13} className="shrink-0 text-error" />}
        <span className={cn("flex-1 truncate", allDone ? "text-text-dim" : "text-muted")}>
          {summary || `${count} tools`}
        </span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-1.5 border-t border-border-soft px-2 py-2">
          {toolBlocks.map((b, i) => renderBlock(b, i, handlers))}
        </div>
      )}
    </div>
  );
}
