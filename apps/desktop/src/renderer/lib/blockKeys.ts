import type { ThreadBlock } from '@workbench/shared';

/** React key of a block: its runtime identity when it has one, else its
 *  position. Blocks without an id are append-only (status lines, dividers,
 *  user messages), so position IS their identity — but a streaming agent /
 *  reasoning / tool block must keep its key while its neighbours come and go,
 *  or React remounts it and drops the state inside (a half-answered question,
 *  an expanded step group).
 *
 *  The DOM anchor stays positional (`block-<index>`), because that is what
 *  JumpBar (and the in-conversation search) resolves against.
 *
 *  Takes the whole union and narrows with `in`, because only some kinds carry
 *  an id. */
export function blockKey(block: ThreadBlock, index: number): string {
  const id = 'id' in block ? block.id : undefined;
  return id ?? `b${index}`;
}
