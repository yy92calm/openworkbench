import type { WikiLintReport, WikiPage, WikiPageMeta, WikiStatus } from '@workbench/shared';
import {
  AlertTriangle,
  CheckCircle2,
  Library,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { MarkdownViewer } from '@/components/markdown-viewer/MarkdownViewer';
import { cn } from '@/lib/cn';
import { wikiCompile, wikiGet, wikiLint, wikiList, wikiStatus } from '@/lib/tauri';
import { toast } from '@/lib/toast';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatTime(value: string | null): string {
  if (!value) return '尚未编译';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * Right-dock wiki browser: agent-compiled pages, read-only. The compile button
 * runs the same manual path as the daily batch; lint is deterministic.
 */
export function WikiDockPanel({ initialSlug }: { initialSlug?: string | null }) {
  const [pages, setPages] = useState<WikiPageMeta[]>([]);
  const [status, setStatus] = useState<WikiStatus | null>(null);
  const [query, setQuery] = useState('');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(initialSlug ?? null);
  const [page, setPage] = useState<WikiPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [lint, setLint] = useState<WikiLintReport | null>(null);

  const open = useCallback(async (slug: string) => {
    setSelectedSlug(slug);
    setLoading(true);
    try {
      setPage(await wikiGet(slug));
    } catch (err) {
      setPage(null);
      toast.error(`无法读取 Wiki 页面：${messageOf(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const [list, nextStatus] = await Promise.all([wikiList(), wikiStatus()]);
    setPages(list);
    setStatus(nextStatus);
    return list;
  }, []);

  useEffect(() => {
    void refresh()
      .then((list) => {
        const target = initialSlug ?? list[0]?.slug;
        if (target) void open(target);
      })
      .catch((err) => toast.error(`无法读取 Wiki：${messageOf(err)}`));
  }, [refresh, open, initialSlug]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter((p) =>
      `${p.slug} ${p.title} ${p.summary} ${p.tags.join(' ')}`.toLowerCase().includes(q),
    );
  }, [pages, query]);

  const compile = async () => {
    setCompiling(true);
    try {
      const result = await wikiCompile();
      if (!result.ok) {
        const reason =
          result.reason === 'no-runtime'
            ? '运行时尚未连接，稍后再试。'
            : result.reason === 'already-running'
              ? '已有编译正在进行中。'
              : (result.error ?? '编译失败');
        toast.error(reason);
        return;
      }
      if (result.reason === 'no-new-sources') {
        toast.success('没有新的素材，Wiki 保持不变。');
      } else {
        toast.success(
          `已编译 ${result.sources} 条素材：新建 ${result.created}，更新 ${result.updated}`,
        );
      }
      const list = await refresh();
      const target =
        selectedSlug && list.some((p) => p.slug === selectedSlug) ? selectedSlug : list[0]?.slug;
      if (target) await open(target);
    } catch (err) {
      toast.error(`编译失败：${messageOf(err)}`);
    } finally {
      setCompiling(false);
    }
  };

  const runLint = async () => {
    if (lint) {
      setLint(null);
      return;
    }
    try {
      setLint(await wikiLint());
    } catch (err) {
      toast.error(`检查失败：${messageOf(err)}`);
    }
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Library size={14} className="shrink-0 text-accent/70" />
        <span className="text-[13px] font-medium text-text">Wiki</span>
        <span className="text-[11px] text-muted">({pages.length})</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void runLint()}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-input text-muted transition-colors hover:bg-surface-2 hover:text-text',
            lint && 'bg-surface-2 text-text',
          )}
          title="检查页面（断链 / 孤立 / 索引漂移）"
        >
          <ShieldCheck size={13} />
        </button>
        <button
          type="button"
          onClick={() => void compile()}
          disabled={compiling}
          className="flex items-center gap-1 rounded-input bg-accent px-2 py-1 text-[11px] font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          title="用新会话与自动记忆编译 Wiki"
        >
          {compiling ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {compiling ? '编译中' : '立即编译'}
        </button>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[10px] text-muted">
        <span className="truncate">上次编译：{formatTime(status?.lastCompiledAt ?? null)}</span>
        <span className="flex-1" />
        <span className="shrink-0">已跟踪 {status?.sourcesTracked ?? 0} 条素材</span>
      </div>

      {/* Search */}
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 rounded-input border border-border-soft bg-bg px-2 py-1">
          <Search size={13} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索页面…"
            className="w-full bg-transparent text-[12px] text-text outline-none placeholder:text-muted"
          />
        </div>
      </div>

      {/* Lint report */}
      {lint && (
        <div className="max-h-40 overflow-y-auto border-b border-border px-3 py-2 text-[11px]">
          <div className="mb-1 flex items-center gap-1.5 text-text-dim">
            {lint.issues.length === 0 ? (
              <CheckCircle2 size={12} className="text-ok" />
            ) : (
              <AlertTriangle size={12} className="text-warn" />
            )}
            <span>
              {lint.pages} 个页面，
              {lint.issues.length === 0 ? '未发现问题' : `${lint.issues.length} 个问题`}
            </span>
          </div>
          {lint.issues.map((issue, index) => (
            <div
              key={`${issue.kind}-${issue.slug ?? ''}-${index}`}
              className={cn('truncate', issue.level === 'error' ? 'text-error' : 'text-warn')}
              title={issue.detail}
            >
              {issue.slug ? `${issue.slug}: ` : ''}
              {issue.detail}
            </div>
          ))}
        </div>
      )}

      {/* List + detail */}
      <div className="flex min-h-0 flex-1">
        <div className="w-[180px] shrink-0 overflow-y-auto border-r border-border p-1.5">
          {visible.length === 0 ? (
            <p className="px-2 py-4 text-center text-[11px] text-muted">
              {pages.length === 0 ? '暂无页面，点击「立即编译」' : '无匹配'}
            </p>
          ) : (
            visible.map((entry) => (
              <button
                key={entry.slug}
                type="button"
                onClick={() => void open(entry.slug)}
                className={cn(
                  'mb-1 block w-full rounded-input px-2 py-1.5 text-left transition-colors',
                  selectedSlug === entry.slug ? 'bg-surface-2' : 'hover:bg-surface-2',
                )}
              >
                <span className="block truncate text-[12px] font-medium text-text">
                  {entry.title || entry.slug}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-muted">
                  {entry.summary}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-3">
          {!selectedSlug ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
              <Library size={20} />
              <p className="text-[12px]">选择左侧页面查看</p>
            </div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 size={16} className="animate-spin text-muted" />
            </div>
          ) : page ? (
            <div className="space-y-2">
              <h3 className="text-[14px] font-semibold text-text">{page.title || page.slug}</h3>
              {page.summary && (
                <p className="text-[11px] leading-snug text-text-dim">{page.summary}</p>
              )}
              {page.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {page.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {page.backlinks.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted">
                  <span>反向链接：</span>
                  {page.backlinks.map((slug) => (
                    <button
                      key={slug}
                      type="button"
                      className="rounded bg-surface-2 px-1.5 py-0.5 text-text-dim hover:text-text"
                      onClick={() => void open(slug)}
                    >
                      {slug}
                    </button>
                  ))}
                </div>
              )}
              <div className="border-t border-border-soft pt-2">
                {page.content.trim() ? (
                  <div className="prose prose-sm max-w-none text-[12px] leading-relaxed text-text">
                    <MarkdownViewer>{page.content}</MarkdownViewer>
                  </div>
                ) : (
                  <p className="text-[12px] text-muted">内容为空</p>
                )}
              </div>
              {page.sources.length > 0 && (
                <div className="border-t border-border-soft pt-2 text-[10px] text-muted">
                  来源：{page.sources.join(', ')}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
