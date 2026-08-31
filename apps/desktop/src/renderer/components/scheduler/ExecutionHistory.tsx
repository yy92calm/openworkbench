import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cn } from '@/lib/cn';
import type { ExecutionRecord } from '@/lib/electron';
import { schedulerClearHistory, schedulerDeleteExecution, schedulerHistory } from '@/lib/electron';
import { toast } from '@/lib/toast';

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  running: { label: '运行中', className: 'text-ok' },
  completed: { label: '已完成', className: 'text-ok' },
  failed: { label: '失败', className: 'text-error' },
  timeout: { label: '超时', className: 'text-warn' },
};

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(0)}秒`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface Props {
  taskId?: string;
}

type Pending = { kind: 'one'; record: ExecutionRecord } | { kind: 'clear' } | null;

export function ExecutionHistory({ taskId }: Props) {
  const [records, setRecords] = useState<ExecutionRecord[]>([]);
  const [pending, setPending] = useState<Pending>(null);

  useEffect(() => {
    schedulerHistory(taskId, 50).then(setRecords);
  }, [taskId]);

  const refresh = () => {
    schedulerHistory(taskId, 50).then(setRecords);
  };

  const onConfirm = async () => {
    if (!pending) return;
    try {
      if (pending.kind === 'one') {
        await schedulerDeleteExecution(pending.record.id);
      } else {
        await schedulerClearHistory(taskId);
      }
      setPending(null);
      refresh();
    } catch (err) {
      toast.error(`删除失败：${err instanceof Error ? err.message : String(err)}`);
      setPending(null);
    }
  };

  if (records.length === 0) {
    return <div className="py-4 text-center text-xs text-muted">暂无执行记录</div>;
  }

  const clearLabel = taskId ? '清空该任务记录' : '清空全部';

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button
          className="flex items-center gap-1 rounded-input px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-error"
          onClick={() => setPending({ kind: 'clear' })}
        >
          <Trash2 size={12} />
          {clearLabel}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-2 pr-3 font-medium">触发时间</th>
              <th className="py-2 pr-3 font-medium">状态</th>
              <th className="py-2 pr-3 font-medium">耗时</th>
              {!taskId && <th className="py-2 pr-3 font-medium">任务</th>}
              <th className="py-2 pr-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const status = STATUS_MAP[r.status] ?? { label: r.status, className: '' };
              return (
                <tr key={r.id} className="border-b border-border/50">
                  <td className="py-2 pr-3 text-text">{formatTime(r.triggeredAt)}</td>
                  <td className="py-2 pr-3">
                    <span className={cn('font-medium', status.className)}>{status.label}</span>
                    {r.error && (
                      <span className="ml-1 text-error" title={r.error}>
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-muted">{formatDuration(r.durationMs)}</td>
                  {!taskId && <td className="py-2 pr-3 text-text">{r.taskName}</td>}
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      {r.sessionId ? (
                        <Link to={`/live/${r.sessionId}`} className="text-link hover:underline">
                          查看对话
                        </Link>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                      <button
                        className="text-muted hover:text-error"
                        aria-label="删除记录"
                        onClick={() => setPending({ kind: 'one', record: r })}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pending && (
        <ConfirmDialog
          title={
            pending.kind === 'one' ? '删除执行记录' : taskId ? '清空该任务记录' : '清空全部执行记录'
          }
          body={
            pending.kind === 'one'
              ? `删除「${pending.record.taskName}」的这条执行记录?此操作不可撤销。`
              : taskId
                ? '清空该任务的所有执行记录?此操作不可撤销。'
                : '清空所有任务的执行记录?此操作不可撤销。'
          }
          confirmLabel="删除"
          onConfirm={onConfirm}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
