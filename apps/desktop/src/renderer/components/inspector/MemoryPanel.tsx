import type { KnowledgeEntry } from '@workbench/shared';
import { BookOpen, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export function MemoryPanel({
  memoryId,
  onClose,
}: {
  memoryId: string;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState<KnowledgeEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEntry(null);
    window.electronAPI
      .knowledgeGet(memoryId)
      .then((e) => {
        if (!cancelled) setEntry(e);
      })
      .catch(() => {
        // entry stays null
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [memoryId]);

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <BookOpen size={14} className="shrink-0 text-accent/70" />
        <span className="flex-1 truncate text-[13px] font-medium text-text">
          {loading ? '加载中…' : entry?.title ?? '记忆'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-input border border-border bg-surface p-1 text-muted hover:bg-surface-2 hover:text-text"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && (
          <p className="text-[13px] text-muted">加载中…</p>
        )}
        {!loading && !entry && (
          <p className="text-[13px] text-muted">未找到该记忆条目。</p>
        )}
        {!loading && entry && (
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-text">
                {entry.title}
              </h2>
              {entry.summary && (
                <p className="mt-1 text-[13px] leading-relaxed text-text-dim">
                  {entry.summary}
                </p>
              )}
            </div>
            {entry.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {entry.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="rounded-lg border border-border-soft bg-surface/50 px-3 py-2.5">
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-text-dim">
                {entry.content}
              </pre>
            </div>
            <div className="flex gap-4 text-[11px] text-muted">
              <span>创建: {new Date(entry.created).toLocaleString()}</span>
              <span>更新: {new Date(entry.updated).toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
