import type { ThreadBlock } from '@workbench/shared';
import { CheckCircle2, Circle, CornerDownRight, ListTodo, Loader2, X } from 'lucide-react';

import { cn } from '@/lib/cn';
import { groupTodos, subtasksOf, type ThreadTodo } from '@/lib/threadTasks';

const SUBTASK_TONE: Record<string, string> = {
  running: 'text-accent',
  pending: 'text-muted',
  'waiting-approval': 'text-warn',
  success: 'text-ok',
  warning: 'text-warn',
  failed: 'text-error',
};

function TodoRow({ todo }: { todo: ThreadTodo }) {
  const done = todo.status === 'completed' || todo.status === 'cancelled';
  return (
    <li className="flex items-start gap-2 py-1">
      {todo.status === 'in_progress' ? (
        <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin text-accent" />
      ) : done ? (
        <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ok" />
      ) : (
        <Circle size={13} className="mt-0.5 shrink-0 text-muted" />
      )}
      <span
        className={cn(
          'min-w-0 flex-1 text-[13px] leading-5',
          done ? 'text-muted line-through' : 'text-text',
        )}
      >
        {todo.content}
      </span>
    </li>
  );
}

/**
 * The agent's todo list and the subagent tasks it spawned, for the session on
 * screen. Both are derived views: todos are captured out of the `todo*` tool
 * calls (which never become conversation rows) and subtasks come from the
 * `task` tool rows that already carry a child session id.
 */
export function TasksPanel({
  todos,
  blocks,
  onOpenSession,
  onClose,
}: {
  todos: readonly ThreadTodo[];
  blocks: readonly ThreadBlock[];
  onOpenSession: (sessionId: string, title: string) => void;
  onClose: () => void;
}) {
  const { open, done } = groupTodos(todos);
  const subtasks = subtasksOf(blocks);
  const isEmpty = todos.length === 0 && subtasks.length === 0;

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[11px] font-medium text-muted">任务</span>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
          aria-label="关闭任务面板"
        >
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        {isEmpty && (
          <p className="px-1 py-4 text-center text-xs text-muted">这个会话还没有待办或子任务。</p>
        )}

        {todos.length > 0 && (
          <section>
            <h3 className="flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted">
              <ListTodo size={12} />
              待办（进行中 {open.length} / 已完成 {done.length}）
            </h3>
            {open.length > 0 && (
              <ul className="mt-1.5">
                {open.map((todo) => (
                  <TodoRow key={todo.content} todo={todo} />
                ))}
              </ul>
            )}
            {done.length > 0 && (
              <ul className="mt-1.5 border-t border-border-soft/60 pt-1.5">
                {done.map((todo) => (
                  <TodoRow key={todo.content} todo={todo} />
                ))}
              </ul>
            )}
          </section>
        )}

        {subtasks.length > 0 && (
          <section>
            <h3 className="flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted">
              <CornerDownRight size={12} />
              子任务（{subtasks.length}）
            </h3>
            <div className="mt-1.5 space-y-1.5">
              {subtasks.map((task) => (
                <button
                  key={task.sessionId}
                  onClick={() => onOpenSession(task.sessionId, task.title)}
                  title="打开这个子会话"
                  className="block w-full rounded-input border border-border bg-surface px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="block truncate text-[13px] text-text">{task.title}</span>
                  <span
                    className={cn(
                      'mt-0.5 block text-[11px]',
                      SUBTASK_TONE[task.status] ?? 'text-muted',
                    )}
                  >
                    {task.status}
                    {task.meta ? ` · ${task.meta}` : ''}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
