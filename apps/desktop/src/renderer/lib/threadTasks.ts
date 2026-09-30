// Derived per-session task views: the agent's todo list and the subagent tasks
// it spawned.
//
// The conversation deliberately does NOT show todo tool rows — they are opaque
// "N todos" noise in a transcript (see foldEvent's drop rule, pinned by a test).
// The data is still useful, so it is captured into the thread and surfaced here
// as a panel instead of as message rows.

import type { ThreadBlock, ToolCallStatus } from '@workbench/shared';

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface ThreadTodo {
  content: string;
  status: TodoStatus;
}

/** A `task` tool call's child session, shown as a card. */
export interface ThreadSubtask {
  sessionId: string;
  title: string;
  status: ToolCallStatus;
  meta?: string;
}

const TODO_STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'completed', 'cancelled'];

/** The agent's todo tools (`todowrite` / `todoread`). */
export function isTodoTool(tool: string): boolean {
  return /^todo/i.test(tool);
}

/** Todos carried by a tool call's input, or null when this call carries none —
 *  null means "keep the previous list", not "the list is now empty". */
export function parseTodos(input: unknown): ThreadTodo[] | null {
  if (!input || typeof input !== 'object') return null;
  const raw = (input as { todos?: unknown }).todos;
  if (!Array.isArray(raw)) return null;
  const todos: ThreadTodo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { content, status } = item as { content?: unknown; status?: unknown };
    if (typeof content !== 'string' || !content.trim()) continue;
    todos.push({
      content: content.trim(),
      status: TODO_STATUSES.includes(status as TodoStatus) ? (status as TodoStatus) : 'pending',
    });
  }
  return todos;
}

/** Open / done split. Cancelled counts as done: it will not be worked on. */
export function groupTodos(todos: readonly ThreadTodo[]): {
  open: ThreadTodo[];
  done: ThreadTodo[];
} {
  const isDone = (t: ThreadTodo) => t.status === 'completed' || t.status === 'cancelled';
  return { open: todos.filter((t) => !isDone(t)), done: todos.filter(isDone) };
}

/** Subtask cards: tool-call blocks that spawned a child session through `task`. */
export function subtasksOf(blocks: readonly ThreadBlock[]): ThreadSubtask[] {
  const out: ThreadSubtask[] = [];
  for (const block of blocks) {
    if (block.kind !== 'tool-call' || !block.childSessionId) continue;
    out.push({
      sessionId: block.childSessionId,
      title: block.title,
      status: block.status,
      ...(block.meta ? { meta: block.meta } : {}),
    });
  }
  return out;
}
