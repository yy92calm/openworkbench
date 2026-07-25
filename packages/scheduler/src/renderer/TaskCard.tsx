import { Clock, Play, Trash2 } from "lucide-react";
import type { ScheduledTask } from "@/lib/electron";
import { cn } from "@/lib/cn";

function humanCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return cron;
  const [min, hour, dom, , dow] = parts;
  if (dom === "*" && dow === "*") return `${hour}:${min.padStart(2, "0")} 每天`;
  if (dom === "*" && dow !== "*") {
    const days = ["日", "一", "二", "三", "四", "五", "六"];
    const dows = dow.split(",").map((d: string) => days[Number(d)] ?? d);
    return `${hour}:${min.padStart(2, "0")} 每周${dows.join("、")}`;
  }
  return cron;
}

function timeAgo(iso: string | undefined): string | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

function timeUntil(iso: string | undefined): string | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return null;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "即将";
  if (mins < 60) return `${mins}分钟后`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时后`;
  return `${Math.floor(hours / 24)}天后`;
}

interface Props {
  task: ScheduledTask;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  onFireNow: (id: string) => void;
  onEdit: (task: ScheduledTask) => void;
  onDelete: (id: string) => void;
}

export function TaskCard({ task, expanded, onToggleExpand, onToggle, onFireNow, onEdit, onDelete }: Props) {
  const lastRun = timeAgo(task.lastRunAt);
  const nextRun = timeUntil(task.nextRunAt);

  return (
    <div className="rounded-card border border-border bg-surface">
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
        onClick={onToggleExpand}
      >
        <span className={cn("h-2 w-2 shrink-0 rounded-full", task.enabled ? "bg-ok" : "bg-muted")} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-text">{task.name}</div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Clock size={12} />
            <span>{humanCron(task.cron)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onFireNow(task.id); }}
            className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
            title="立即执行"
          >
            <Play size={14} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(task); }}
            className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
            title="编辑"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
            className="rounded p-1 text-muted hover:bg-surface-2 hover:text-error"
            title="删除"
          >
            <Trash2 size={14} />
          </button>
          <label className="relative ml-1 inline-flex cursor-pointer items-center" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              className="peer sr-only"
              checked={task.enabled}
              onChange={(e) => onToggle(task.id, e.target.checked)}
            />
            <div className="h-5 w-9 rounded-full bg-border peer-checked:bg-accent transition-colors" />
            <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
          </label>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          <div className="flex gap-4 text-xs text-muted">
            <span>{lastRun ? `上次执行：${lastRun}` : "尚未执行"}</span>
            <span>{nextRun ? `下次执行：${nextRun}` : "—"}</span>
          </div>
          <div className="rounded bg-surface-2 p-2 text-xs text-text font-mono whitespace-pre-wrap">
            {task.prompt}
          </div>
          {task.agent && (
            <div className="text-xs text-muted">Agent: {task.agent}</div>
          )}
          {task.tags && task.tags.length > 0 && (
            <div className="flex gap-1">
              {task.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{tag}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}