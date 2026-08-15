import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import type { ExecutionRecord } from "@workbench/sdk";
import { getHostClient } from "@/lib/connection";
import { formatDuration, timeAgo } from "@/lib/format";
import { ActionSheet } from "@/components/ActionSheet";

interface Props {
  taskId: string;
  taskName: string;
  onBack: () => void;
}

const STATUS_LABEL: Record<ExecutionRecord["status"], string> = {
  running: "执行中",
  completed: "成功",
  failed: "失败",
  timeout: "超时",
};

const STATUS_COLOR: Record<ExecutionRecord["status"], string> = {
  running: "var(--warn)",
  completed: "var(--ok)",
  failed: "var(--error)",
  timeout: "var(--warn)",
};

export function HistoryPage({ taskId, taskName, onBack }: Props) {
  const [records, setRecords] = useState<ExecutionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const host = getHostClient();
      setRecords(await host.getHistory(taskId, 100));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clearAll = async () => {
    setConfirmClear(false);
    try {
      await getHostClient().clearHistory(taskId);
      setRecords([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <button onClick={onBack} className="icon-btn" aria-label="返回">
          <ArrowLeft size={18} />
        </button>
        <h1 className="page-title">{taskName}</h1>
        {records.length > 0 && (
          <button onClick={() => setConfirmClear(true)} className="icon-btn danger" aria-label="清空" title="清空历史">
            <Trash2 size={16} />
          </button>
        )}
      </header>

      {error && <div className="page-error">{error}</div>}

      {loading ? (
        <div className="page-empty">加载中…</div>
      ) : records.length === 0 ? (
        <div className="page-empty">暂无执行记录</div>
      ) : (
        <div className="history-list">
          {records.map((rec) => {
            const expanded = expandedId === rec.id;
            return (
              <div key={rec.id} className="history-card">
                <button
                  className="history-card-head"
                  onClick={() => setExpandedId(expanded ? null : rec.id)}
                >
                  <span className="history-status-dot" style={{ background: STATUS_COLOR[rec.status] }} />
                  <div className="history-info">
                    <div className="history-status">{STATUS_LABEL[rec.status]}</div>
                    <div className="history-time">{timeAgo(rec.triggeredAt)}</div>
                  </div>
                  <span className="history-duration">{formatDuration(rec.durationMs)}</span>
                </button>
                {expanded && rec.error && (
                  <div className="history-error">{rec.error}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {confirmClear && (
        <ActionSheet
          title="清空所有执行记录？"
          options={[
            { label: "清空", danger: true, onClick: () => void clearAll() },
          ]}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
