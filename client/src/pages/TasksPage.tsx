import { useCallback, useEffect, useState } from "react";
import { Clock, Play, Plus, RefreshCw, Trash2, ChevronRight } from "lucide-react";
import type { ScheduledTask } from "@workbench/sdk";
import { getHostClient, isConnected } from "@/lib/connection";
import { humanCron, timeAgo, timeUntil } from "@/lib/format";
import { ActionSheet } from "@/components/ActionSheet";
import { DeviceRequiredCard } from "@/components/DeviceRequiredCard";

interface Props {
  onNew: () => void;
  onEdit: (id: string) => void;
  onHistory: (taskId: string, taskName: string) => void;
}

export function TasksPage({ onNew, onEdit, onHistory }: Props) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionSheet, setActionSheet] = useState<{ task: ScheduledTask } | null>(null);
  const [toast, setToast] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      const host = getHostClient();
      setTasks(await host.listTasks());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isConnected()) return;
    void refresh();
    const t = setInterval(() => void refresh(), 15000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!isConnected()) {
    return <DeviceRequiredCard />;
  }

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const toggle = async (id: string, enabled: boolean) => {
    try {
      await getHostClient().toggleTask(id, enabled);
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, enabled } : t)));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "切换失败");
    }
  };

  const fireNow = async (id: string) => {
    try {
      await getHostClient().fireNow(id);
      showToast("已触发");
      void refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "触发失败");
    }
  };

  const remove = async (id: string) => {
    try {
      await getHostClient().deleteTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      showToast("已删除");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "删除失败");
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">定时任务</h1>
        <button onClick={() => void refresh()} className="icon-btn" aria-label="刷新">
          <RefreshCw size={16} />
        </button>
        <button onClick={onNew} className="icon-btn accent" aria-label="新建" title="新建任务">
          <Plus size={18} />
        </button>
      </header>

      {error && <div className="page-error">{error}</div>}

      {loading ? (
        <div className="page-empty">加载中…</div>
      ) : tasks.length === 0 ? (
        <div className="page-empty">还没有定时任务，点击 + 创建第一个</div>
      ) : (
        <div className="task-list">
          {tasks.map((task) => {
            const expanded = expandedId === task.id;
            const lastRun = timeAgo(task.lastRunAt);
            const nextRun = timeUntil(task.nextRunAt);
            return (
              <div key={task.id} className="task-card">
                <button
                  className="task-card-head"
                  onClick={() => setExpandedId(expanded ? null : task.id)}
                >
                  <span className={`task-dot ${task.enabled ? "on" : "off"}`} />
                  <div className="task-card-info">
                    <div className="task-name">{task.name}</div>
                    <div className="task-cron">
                      <Clock size={12} />
                      <span>{humanCron(task.cron)}</span>
                    </div>
                  </div>
                  <ChevronRight size={16} className={`task-chevron ${expanded ? "open" : ""}`} />
                </button>

                {expanded && (
                  <div className="task-card-body">
                    <div className="task-meta">
                      <span>{lastRun ? `上次：${lastRun}` : "尚未执行"}</span>
                      <span>{nextRun ? `下次：${nextRun}` : "—"}</span>
                    </div>
                    <div className="task-prompt">{task.prompt}</div>
                    {task.agent && <div className="task-agent">Agent: {task.agent}</div>}
                    {task.tags && task.tags.length > 0 && (
                      <div className="task-tags">
                        {task.tags.map((tag) => (
                          <span key={tag} className="task-tag">{tag}</span>
                        ))}
                      </div>
                    )}
                    <div className="task-actions">
                      <button className="task-action-btn" onClick={() => void fireNow(task.id)}>
                        <Play size={14} /> 立即执行
                      </button>
                      <button className="task-action-btn" onClick={() => onEdit(task.id)}>
                        编辑
                      </button>
                      <button className="task-action-btn" onClick={() => onHistory(task.id, task.name)}>
                        历史
                      </button>
                      <button
                        className="task-action-btn danger"
                        onClick={() => setActionSheet({ task })}
                      >
                        <Trash2 size={14} /> 删除
                      </button>
                    </div>
                    <label className="task-toggle-row">
                      <span>{task.enabled ? "已启用" : "已停用"}</span>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={task.enabled}
                          onChange={(e) => void toggle(task.id, e.target.checked)}
                        />
                        <span className="slider" />
                      </label>
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {actionSheet && (
        <ActionSheet
          title={`删除「${actionSheet.task.name}」？`}
          options={[
            {
              label: "删除",
              danger: true,
              onClick: () => {
                const id = actionSheet.task.id;
                setActionSheet(null);
                void remove(id);
              },
            },
          ]}
          onCancel={() => setActionSheet(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
