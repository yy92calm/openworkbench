import type { KnowledgeEntryMeta, KnowledgeInput } from '@workbench/shared';
import { BookOpen, Loader2, Plus, Save, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { MarkdownViewer } from '@/components/markdown-viewer/MarkdownViewer';
import { cn } from '@/lib/cn';
import {
  knowledgeCategories,
  knowledgeDelete,
  knowledgeGet,
  knowledgeList,
  knowledgeSave,
  knowledgeSaveCategories,
} from '@/lib/tauri';
import { toast } from '@/lib/toast';

/** '' means "uncategorised" — stored as an empty category, not a named bucket. */
const NO_CATEGORY = '';
const ALL = '__all__';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Personal knowledge base: a searchable list of markdown entries on the left,
 * an editor on the right. Entries live in the app's userData (`knowledge/`),
 * independent of the OpenCode profile, and can be referenced from a chat with
 * `@` — the body then travels as its own reference paragraph.
 */
export function KnowledgePage() {
  const [entries, setEntries] = useState<KnowledgeEntryMeta[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>(ALL);
  const [draft, setDraft] = useState<KnowledgeInput | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [list, cats] = await Promise.all([knowledgeList(), knowledgeCategories()]);
    setEntries(list);
    setCategories(cats);
  }, []);

  useEffect(() => {
    void refresh().catch((err) => toast.error(`无法读取知识库：${messageOf(err)}`));
  }, [refresh]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter !== ALL && entry.category !== filter) return false;
      if (!q) return true;
      return `${entry.title} ${entry.summary} ${entry.category} ${entry.tags.join(' ')}`
        .toLowerCase()
        .includes(q);
    });
  }, [entries, filter, query]);

  const openNew = () => {
    setPreview(false);
    setDraft({
      title: '',
      summary: '',
      category: filter === ALL ? NO_CATEGORY : filter,
      tags: [],
      content: '',
    });
  };

  const openEntry = async (id: string) => {
    try {
      const entry = await knowledgeGet(id);
      setPreview(false);
      setDraft({
        id: entry.id,
        title: entry.title,
        summary: entry.summary,
        category: entry.category,
        tags: entry.tags,
        content: entry.content,
      });
    } catch (err) {
      toast.error(`无法打开条目：${messageOf(err)}`);
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const saved = await knowledgeSave(draft);
      // A category typed for the first time joins the library's category list.
      const category = (draft.category ?? '').trim();
      if (category && !categories.includes(category)) {
        setCategories(await knowledgeSaveCategories([...categories, category]));
      }
      await refresh();
      setDraft({ ...draft, id: saved.id });
      toast.success('已保存');
    } catch (err) {
      // The store rejects a blank title / summary / body with a reason.
      toast.error(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    setBusy(true);
    try {
      await knowledgeDelete(draft.id);
      setDraft(null);
      await refresh();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-hidden">
      <div className="mx-auto flex h-full max-w-6xl flex-col px-8 py-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-text">知识库</h1>
            <p className="mt-1 text-sm text-muted">
              把想法、步骤、提示词沉淀下来；在对话里用 @ 引用，正文会作为独立参考资料发给模型。
            </p>
          </div>
          <button
            className="flex shrink-0 items-center gap-1.5 rounded-input border border-border bg-surface px-3 py-1.5 text-[13px] text-text transition-colors hover:bg-surface-2"
            onClick={openNew}
          >
            <Plus size={14} />
            新建条目
          </button>
        </header>

        <div className="mt-5 flex min-h-0 flex-1 gap-4">
          {/* Library */}
          <aside className="flex w-[280px] shrink-0 flex-col rounded-card border border-border bg-surface shadow-card">
            <div className="space-y-2 border-b border-border px-3 py-3">
              <div className="flex items-center gap-2 rounded-input border border-border-soft bg-bg px-2 py-1">
                <Search size={13} className="shrink-0 text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索标题 / 说明 / 标签…"
                  className="w-full bg-transparent text-[13px] text-text outline-none placeholder:text-muted"
                />
              </div>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full rounded-input border border-border-soft bg-bg px-2 py-1 text-[13px] text-text outline-none"
              >
                <option value={ALL}>全部分类（{entries.length}）</option>
                <option value={NO_CATEGORY}>未分类</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {visible.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted">
                  {entries.length === 0 ? '还没有条目。' : '没有匹配的条目。'}
                </p>
              ) : (
                visible.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => void openEntry(entry.id)}
                    className={cn(
                      'mb-1 block w-full rounded-input px-2.5 py-2 text-left transition-colors',
                      draft?.id === entry.id ? 'bg-surface-2' : 'hover:bg-surface-2',
                    )}
                  >
                    <span className="block truncate text-[13px] font-medium text-text">
                      {entry.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted">
                      {entry.category ? `${entry.category} · ` : ''}
                      {entry.summary}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          {/* Editor */}
          <section className="flex min-w-0 flex-1 flex-col rounded-card border border-border bg-surface shadow-card">
            {!draft ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted">
                <BookOpen size={22} />
                <p className="text-sm">选择左侧条目，或新建一个。</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <input
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    placeholder="标题（必填）"
                    className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-text outline-none placeholder:text-muted"
                  />
                  <button
                    className={cn(
                      'shrink-0 rounded-input px-2 py-1 text-xs transition-colors',
                      preview ? 'bg-surface-2 text-text' : 'text-muted hover:text-text',
                    )}
                    onClick={() => setPreview((p) => !p)}
                  >
                    {preview ? '编辑' : '预览'}
                  </button>
                  <button
                    className="shrink-0 rounded-input p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-error disabled:opacity-40"
                    onClick={() => void remove()}
                    disabled={busy || !draft.id}
                    aria-label="删除条目"
                    title={draft.id ? '删除条目' : '尚未保存'}
                  >
                    <Trash2 size={14} />
                  </button>
                  <button
                    className="flex shrink-0 items-center gap-1.5 rounded-input bg-accent px-3 py-1.5 text-[13px] text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
                    onClick={() => void save()}
                    disabled={busy}
                  >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    保存
                  </button>
                </div>

                <div className="space-y-2 border-b border-border px-4 py-3">
                  <input
                    value={draft.summary}
                    onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                    placeholder="说明（必填，一句话概括这条知识）"
                    className="w-full rounded-input border border-border-soft bg-bg px-2.5 py-1.5 text-[13px] text-text outline-none placeholder:text-muted focus:border-accent/40"
                  />
                  <div className="flex gap-2">
                    <input
                      value={draft.category ?? ''}
                      onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                      placeholder="分类（可留空；用 / 表示层级，如 投资/宏观）"
                      list="knowledge-categories"
                      className="min-w-0 flex-1 rounded-input border border-border-soft bg-bg px-2.5 py-1.5 text-[13px] text-text outline-none placeholder:text-muted focus:border-accent/40"
                    />
                    <datalist id="knowledge-categories">
                      {categories.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                    <input
                      value={(draft.tags ?? []).join(', ')}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          tags: e.target.value
                            .split(',')
                            .map((t) => t.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="标签，逗号分隔"
                      className="min-w-0 flex-1 rounded-input border border-border-soft bg-bg px-2.5 py-1.5 text-[13px] text-text outline-none placeholder:text-muted focus:border-accent/40"
                    />
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  {preview ? (
                    draft.content.trim() ? (
                      <MarkdownViewer>{draft.content}</MarkdownViewer>
                    ) : (
                      <p className="text-sm text-muted">正文为空。</p>
                    )
                  ) : (
                    <textarea
                      value={draft.content}
                      onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                      placeholder="正文（必填，支持 Markdown）"
                      className="h-full min-h-[240px] w-full resize-none bg-transparent font-mono text-[13px] leading-6 text-text outline-none placeholder:text-muted"
                      spellCheck={false}
                    />
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
