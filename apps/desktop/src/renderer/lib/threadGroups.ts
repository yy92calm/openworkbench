// Work-block grouping predicates for the thread (see
// docs/20260909-03-work-group-short-output.md). Pure and testable: decides
// which consecutive blocks may merge into one collapsed StepGroup.
import type { ThreadBlock } from '@workbench/shared';

/** Max length of an agent message that still counts as a "short output" —
 *  brief narration between tool calls ("让我查一下…") rather than a real
 *  answer. Real answers break the group. */
export const SHORT_OUTPUT_LIMIT = 200;

/** Structural markdown that makes an agent message a "real answer" even when
 *  short: fenced code, headings, tables. Conservative on purpose — grouping
 *  must never swallow content the user should read directly. */
const STRUCTURED = /(^|\n)\s*(```|#{1,6}\s|\|)/;

export function isShortAgentOutput(block: ThreadBlock): boolean {
  if (block.kind !== 'agent') return false;
  const text = block.markdown;
  return text.length <= SHORT_OUTPUT_LIMIT && !STRUCTURED.test(text);
}

/** A block that can sit inside a merged work group (StepGroup). */
export function isGroupableWorkBlock(block: ThreadBlock): boolean {
  return (
    block.kind === 'reasoning' ||
    block.kind === 'tool-call' ||
    block.kind === 'status-line' ||
    isShortAgentOutput(block)
  );
}

/** True when any block in the group is still producing output. */
export function groupIsStreaming(blocks: ThreadBlock[]): boolean {
  return blocks.some(
    (b) =>
      (b.kind === 'reasoning' && b.streaming) ||
      (b.kind === 'tool-call' && b.status === 'running') ||
      (b.kind === 'agent' && !b.timestamp),
  );
}
