import type {
  ArtifactBlock,
  FigureAnnotation,
  ReasoningBlock,
  ThreadBlock,
  ToolCallBlock,
} from '@workbench/shared';
import { Brain, Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/cn';
import { useUiStore } from '@/lib/store';

import { ArtifactCard } from './ArtifactCard';
import { AgentMessage, DataTable, RunningJobsOverlay, StatusLine, UserMessage } from './atoms';
import { FigureBlock } from './FigureBlock';
import { ReasoningCard } from './ReasoningCard';
import { ShellCard } from './ShellCard';
import { StepSummaryRow } from './StepSummaryRow';
import { ToolCallRow } from './ToolCallRow';
import { TurnDivider } from './TurnDivider';

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

/** A renderable item: either a single block or a merged group of consecutive
 *  reasoning + tool-call blocks (a "step" run). */
type RenderItem =
  | { type: 'block'; block: ThreadBlock; key: number }
  | { type: 'step-group'; blocks: ThreadBlock[]; key: number };

/** Pre-process blocks: merge consecutive reasoning + tool-call blocks into a
 *  single collapsible group so thinking and tools fold together. A lone block
 *  (only one in the run) renders on its own. */
function prepareItems(blocks: ThreadBlock[]): RenderItem[] {
  const items: RenderItem[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.kind === 'reasoning' || b.kind === 'tool-call') {
      const start = i;
      while (
        i < blocks.length &&
        (blocks[i].kind === 'reasoning' || blocks[i].kind === 'tool-call')
      )
        i++;
      const run = blocks.slice(start, i);
      if (run.length >= 2) {
        items.push({ type: 'step-group', blocks: run, key: start });
      } else {
        items.push({ type: 'block', block: run[0], key: start });
      }
    } else {
      items.push({ type: 'block', block: b, key: i });
      i++;
    }
  }
  return items;
}

/** Spacing rhythm: different block transitions need different visual gaps. */
function spacingBefore(kind: ThreadBlock['kind']): string {
  switch (kind) {
    case 'user':
      return 'mt-5';
    case 'agent':
      return 'mt-4';
    case 'tool-call':
    case 'step-summary':
      return 'mt-1.5';
    case 'reasoning':
      return 'mt-3';
    case 'turn-divider':
      return 'mt-2';
    default:
      return 'mt-2';
  }
}

export function renderBlock(
  block: ThreadBlock,
  i: number,
  handlers?: BlockHandlers,
  prevKind?: ThreadBlock['kind'],
) {
  const sp = spacingBefore(block.kind);
  switch (block.kind) {
    case 'turn-divider':
      return <TurnDivider key={i} block={block} />;
    case 'user':
      return (
        <div key={i} id={`block-${i}`} className={prevKind ? sp : ''}>
          <UserMessage block={block} onEdit={handlers?.onUserMessageEdit} />
        </div>
      );
    case 'agent':
      return (
        <div key={i} className={prevKind ? sp : ''}>
          <AgentMessage
            markdown={block.markdown}
            timestamp={block.timestamp}
            streaming={!block.timestamp}
            onOpenArtifact={handlers?.onArtifactOpen}
          />
        </div>
      );
    case 'reasoning':
      return (
        <div key={i} className={prevKind ? sp : ''}>
          <ReasoningCard block={block} />
        </div>
      );
    case 'step-summary':
      return (
        <div key={i} className={prevKind ? sp : ''}>
          <StepSummaryRow block={block} />
        </div>
      );
    case 'tool-call':
      // Shell commands get their own card
      if (block.shellCommand) {
        return (
          <div key={i} className={prevKind ? sp : ''}>
            <ShellCard block={block} />
          </div>
        );
      }
      return (
        <div key={i} className={prevKind ? sp : ''}>
          <ToolCallRow
            block={block}
            activity={
              block.childSessionId ? handlers?.subagentActivity?.(block.childSessionId) : undefined
            }
          />
        </div>
      );
    case 'table':
      return (
        <div key={i} className={prevKind ? sp : ''}>
          <DataTable block={block} />
        </div>
      );
    case 'figure':
      return (
        <div key={i} className={prevKind ? sp : ''}>
          <FigureBlock block={block} onComment={handlers?.onFigureComment} />
        </div>
      );
    case 'artifact':
      return (
        <div key={i} className={prevKind ? sp : ''}>
          <ArtifactCard block={block} onOpen={handlers?.onArtifactOpen} />
        </div>
      );
    case 'running-jobs':
      return (
        <div key={i} className={prevKind ? sp : ''}>
          <RunningJobsOverlay block={block} />
        </div>
      );
    case 'status-line':
      return (
        <div key={i} className={prevKind ? sp : ''}>
          <StatusLine block={block} />
        </div>
      );
  }
}

export function BlockList({
  blocks,
  handlers,
  warmCount = 40,
}: {
  blocks: ThreadBlock[];
  handlers?: BlockHandlers;
  /** How many of the newest blocks render up front; older ones fold behind an
   *  "expand earlier history" placeholder and only render on demand. Warm/cold
   *  layering for long sessions — the full list is never rendered at once. */
  warmCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = blocks.length;
  const isCold = total > warmCount;

  // The warm list is the last `warmCount` items. When the list grows past the
  // threshold the fold boundary moves forward; rendering the new tail replaces
  // the placeholder. The fold never collapses the LIVE tail mid-stream.
  const items = useMemo(() => {
    const all = prepareItems(blocks);
    if (!isCold || expanded) return all;
    return all.slice(-warmCount);
  }, [blocks, isCold, expanded, warmCount]);

  const coldCount = total - warmCount;

  return (
    <>
      {isCold && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-2 rounded-lg border border-border-soft bg-surface/40 px-3 py-2 text-left text-[13px] text-muted transition-colors hover:bg-surface-2/40 hover:text-text"
        >
          <ChevronDown size={14} className="shrink-0" />
          <span className="flex-1 truncate">展开更早历史（{coldCount} 条）</span>
        </button>
      )}
      {items.map((item, idx) => {
        if (item.type === 'block') {
          const prevKind =
            idx > 0
              ? items[idx - 1].type === 'step-group'
                ? ('tool-call' as const)
                : (items[idx - 1] as { type: 'block'; block: ThreadBlock }).block.kind
              : undefined;
          return renderBlock(item.block, item.key, handlers, prevKind);
        }
        // Step group (reasoning + tool calls merged)
        const prevKind =
          idx > 0
            ? items[idx - 1].type === 'step-group'
              ? ('tool-call' as const)
              : (items[idx - 1] as { type: 'block'; block: ThreadBlock }).block.kind
            : undefined;
        return (
          <div key={item.key} className={prevKind ? spacingBefore('tool-call') : ''}>
            <StepGroup blocks={item.blocks} handlers={handlers} />
          </div>
        );
      })}
    </>
  );
}

/** A collapsed view of a single reasoning block, shown inline inside an
 *  expanded StepGroup (no nested fold - the group already owns the fold).
 *  Streaming shows the animated accent + "思考中…" label. */
function ReasoningInline({ block }: { block: ReasoningBlock }) {
  const isStreaming = !!block.streaming;
  return (
    <div className="relative flex">
      <div
        className={cn(
          'w-[2px] shrink-0 rounded-full mr-3 transition-all duration-300',
          isStreaming
            ? 'bg-gradient-to-b from-accent via-accent/50 to-transparent bg-[length:2px_200%] animate-[gradient-shimmer_2s_linear_infinite]'
            : 'bg-border',
        )}
      />
      <div
        className={cn(
          'min-w-0 flex-1 rounded-lg border transition-colors',
          isStreaming ? 'border-accent/20 bg-accent/[0.02]' : 'border-border-soft bg-surface/50',
        )}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium text-text-dim">
          {isStreaming ? (
            <Loader2 size={12} className="animate-spin text-accent" />
          ) : (
            <Brain size={12} className="text-accent/70" />
          )}
          <span>{isStreaming ? '思考中…' : '思考过程'}</span>
        </div>
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words px-3 pb-2.5 pt-0.5 font-mono text-[12px] leading-relaxed text-text-dim">
          {block.text}
        </pre>
      </div>
    </div>
  );
}

/** Merged reasoning + tool-call run. Collapsed by default (thinking and tools
 *  fold together); expanding shows the reasoning text inline plus each tool
 *  row (which still has its own detail fold). Auto-expands while streaming so
 *  live thinking/running tools stay visible. */
function StepGroup({ blocks, handlers }: { blocks: ThreadBlock[]; handlers?: BlockHandlers }) {
  const isStreaming =
    blocks.some((b) => b.kind === 'reasoning' && b.streaming) ||
    blocks.some((b) => b.kind === 'tool-call' && b.status === 'running');
  // Default fold follows the global setting; streaming does NOT auto-expand -
  // the user opted into collapsed, so a live indicator on the header is enough
  // and they can expand by hand. Setting changes apply immediately (re-folds
  // every group to the new default).
  const expandDefault = useUiStore((s) => s.expandThreadDetails);
  const [expanded, setExpanded] = useState(expandDefault);
  useEffect(() => {
    setExpanded(expandDefault);
  }, [expandDefault]);

  const reasoningCount = blocks.filter((b) => b.kind === 'reasoning').length;
  const toolBlocks = blocks.filter((b): b is ToolCallBlock => b.kind === 'tool-call');
  const toolCount = toolBlocks.length;
  const failed = toolBlocks.filter((b) => b.status === 'failed').length;
  const allDone =
    toolCount > 0 &&
    toolBlocks.every(
      (b) => b.status === 'success' || b.status === 'failed' || b.status === 'warning',
    );

  const parts: string[] = [];
  if (reasoningCount) parts.push(`思考过程${reasoningCount > 1 ? ` ×${reasoningCount}` : ''}`);
  if (toolCount) parts.push(`${toolCount} 个工具`);
  const summary = parts.join(' · ') || '步骤';

  return (
    <div className="rounded-lg border border-border-soft bg-surface/40">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2/40"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />
        {/* Streaming pulse / done / failed marker */}
        {isStreaming ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent animate-pulse" />
        ) : allDone && !failed ? (
          <Check size={13} className="shrink-0 text-ok" />
        ) : failed > 0 ? (
          <X size={13} className="shrink-0 text-error" />
        ) : null}
        <span
          className={cn(
            'flex-1 truncate',
            isStreaming ? 'text-text' : allDone ? 'text-text-dim' : 'text-muted',
          )}
        >
          {summary}
        </span>
        {isStreaming && <Loader2 size={12} className="shrink-0 animate-spin text-accent" />}
      </button>
      {expanded && (
        <div className="flex flex-col gap-1.5 border-t border-border-soft px-2 py-2">
          {blocks.map((b, i) =>
            b.kind === 'reasoning' ? (
              <ReasoningInline key={i} block={b} />
            ) : (
              renderBlock(b, i, handlers)
            ),
          )}
        </div>
      )}
    </div>
  );
}
