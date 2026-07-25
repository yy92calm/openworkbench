import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import type { ExecutionRecord } from "@/lib/electron";
import { schedulerHistory } from "@/lib/electron";
import { cn } from "@/lib/cn";

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  running: { label: "运行中", className: "text-ok" },
  completed: { label: "已完成", className: "text-ok" },
  failed: { label: "失败", className: "text-error" },
  timeout: { label: "超时", className: "text-warn" },
};

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(0)}秒`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  taskId?: string;
}

export function ExecutionHistory({ taskId }: Props) {
  const [records, setRecords] = useState<ExecutionRecord[]>([]);

  useEffect(() => {
    schedulerHistory(taskId, 50).then(setRecords);
  }, [taskId]);

  if (records.length === 0) {
    return <div className="py-4 text-center text-xs text-muted">暂无执行记录</div>;
  }

  return (
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
            const status = STATUS_MAP[r.status] ?? { label: r.status, className: "" };
            return (
              <tr key={r.id} className="border-b border-border/50">
                <td className="py-2 pr-3 text-text">{formatTime(r.triggeredAt)}</td>
                <td className="py-2 pr-3">
                  <span className={cn("font-medium", status.className)}>{status.label}</span>
                  {r.error && <span className="ml-1 text-error" title={r.error}>⚠</span>}
                </td>
                <td className="py-2 pr-3 text-muted">{formatDuration(r.durationMs)}</td>
                {!taskId && <td className="py-2 pr-3 text-text">{r.taskName}</td>}
                <td className="py-2 pr-3">
                  {r.sessionId ? (
                    <Link to={`/live/${r.sessionId}`} className="text-link hover:underline">
                      查看对话
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}