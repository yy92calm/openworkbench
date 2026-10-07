import type { KnowledgeEntryMeta } from '@workbench/shared';
import { Brain, Loader2, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { MarkdownViewer } from '@/components/markdown-viewer/MarkdownViewer';
import { cn } from '@/lib/cn';
import { knowledgeGet, knowledgeList } from '@/lib/tauri';
import { toast } from '@/lib/toast';

/**
 * Right-dock memory browser: shows the knowledge list on the left,
 * full entry content on the right. Read-only view for quick reference.
 */
export function MemoryDockPanel() {
  const [entries, setEntries] = useState<KnowledgeEntryMeta[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const list = await knowledgeList();
    setEntries(list);
  }, []);

  useEffect(() => {
    void refresh().catch((err) => toast.error(`无法读取记忆：${err instanceof Error ? err.message : String(err)}`));
  }, [refresh]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      `${e.title} ${e.summary} ${e.tags.join(' ')}`.toLowerCase().includes(q),
    );
  }, [entries, query]);

  const openEntry = async (id: string) => {
    setSelectedId(id);
    setLoading(true);
    try {
      const entry = await knowledgeGet(id);
      setSelectedContent(entry.content);
    } catch (err) {
      toast.error(`无法读取记忆：${err instanceof Error ? err.message : String(err)}`);
      setSelectedContent('');
    } finally {
      setLoading(false);
    }
  };

  const selectedEntry = entries.find((e) => e.id === selectedId);

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Brain size={14} className="shrink-0 text-accent/70" />
        <span className="text-[13px] font-medium text-text">记忆库</span>
        <span className="text-[11px] text-muted">({entries.length})</span>
      </div>

      {/* Search */}
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 rounded-input border border-border-soft bg-bg px-2 py-1">
          <Search size={13} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索记忆…"
            className="w-full bg-transparent text-[12px] text-text outline-none placeholder:text-muted"
          />
        </div>
      </div>

      {/* Content area */}
      <div className="flex min-h-0 flex-1">
        {/* List */}
        <div className="w-[180px] shrink-0 overflow-y-auto border-r border-border p-1.5">
          {visible.length === 0 ? (
            <p className="px-2 py-4 text-center text-[11px] text-muted">
              {entries.length === 0 ? '暂无记忆' : '无匹配'}
            </p>
          ) : (
            visible.map((entry) => (
              <button
                key={entry.id}
                onClick={() => void openEntry(entry.id)}
                className={cn(
                  'mb-1 block w-full rounded-input px-2 py-1.5 text-left transition-colors',
                  selectedId === entry.id ? 'bg-surface-2' : 'hover:bg-surface-2',
                )}
              >
                <span className="block truncate text-[12px] font-medium text-text">
                  {entry.title}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-muted">
                  {entry.summary}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Detail */}
        <div className="min-w-0 flex-1 overflow-y-auto p-3">
          {!selectedId ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
              <Brain size={20} />
              <p className="text-[12px]">选择左侧记忆查看详情</p>
            </div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 size={16} className="animate-spin text-muted" />
            </div>
          ) : selectedEntry ? (
            <div className="space-y-2">
              <h3 className="text-[14px] font-semibold text-text">{selectedEntry.title}</h3>
              {selectedEntry.summary && (
                <p className="text-[11px] leading-snug text-text-dim">{selectedEntry.summary}</p>
              )}
              {selectedEntry.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedEntry.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="border-t border-border-soft pt-2">
                {selectedContent.trim() ? (
                  <div className="prose prose-sm max-w-none text-[12px] leading-relaxed text-text">
                    <MarkdownViewer>{selectedContent}</MarkdownViewer>
                  </div>
                ) : (
                  <p className="text-[12px] text-muted">内容为空</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
