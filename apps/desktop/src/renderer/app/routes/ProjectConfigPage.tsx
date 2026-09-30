import type { ProjectConfigCategory, ProjectConfigFile } from '@workbench/shared';
import { FileText, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { MarkdownViewer } from '@/components/markdown-viewer/MarkdownViewer';
import { cn } from '@/lib/cn';
import { projectConfigRead, projectConfigSummary } from '@/lib/tauri';
import { toast } from '@/lib/toast';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Read-only overview of the profile the runtime is actually running: core
 * config, instructions, commands, rules and skills, with a preview pane.
 * Everything that *changes* configuration lives in settings (the patch overlay
 * and the natural-language config dialogue) — this page only answers "what is
 * in there right now".
 */
export function ProjectConfigPage() {
  const [categories, setCategories] = useState<ProjectConfigCategory[]>([]);
  const [selected, setSelected] = useState<ProjectConfigFile | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const openFile = useCallback(async (file: ProjectConfigFile) => {
    setSelected(file);
    setLoading(true);
    try {
      setContent(await projectConfigRead(file.rel));
    } catch (err) {
      setContent(null);
      toast.error(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const list = await projectConfigSummary();
        setCategories(list);
        const first = list.flatMap((c) => c.files)[0];
        if (first) await openFile(first);
      } catch (err) {
        toast.error(`无法读取配置：${messageOf(err)}`);
      }
    })();
  }, [openFile]);

  const total = categories.reduce((sum, category) => sum + category.files.length, 0);
  const isMarkdown = selected?.name.endsWith('.md') ?? false;

  return (
    <div className="h-full overflow-hidden">
      <div className="mx-auto flex h-full max-w-6xl flex-col px-8 py-8">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-text">配置总览</h1>
          <p className="mt-1 text-sm text-muted">
            当前生效的 .opencode 配置（共 {total} 个文件）。只读预览；改配置请到「设置」。
          </p>
        </header>

        <div className="mt-5 flex min-h-0 flex-1 gap-4">
          <aside className="w-[300px] shrink-0 overflow-y-auto rounded-card border border-border bg-surface p-2 shadow-card">
            {categories.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted">还没有配置可展示。</p>
            ) : (
              categories.map((category) => (
                <section key={category.id} className="mb-2">
                  <h2 className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
                    {category.label}（{category.files.length}）
                  </h2>
                  {category.files.length === 0 ? (
                    <p className="px-2 pb-1 text-[11px] text-muted/70">空</p>
                  ) : (
                    category.files.map((file) => (
                      <button
                        key={file.rel}
                        onClick={() => void openFile(file)}
                        title={file.rel}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left transition-colors',
                          selected?.rel === file.rel ? 'bg-surface-2' : 'hover:bg-surface-2',
                        )}
                      >
                        <FileText size={12} className="shrink-0 text-muted" />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                          {file.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted">
                          {Math.max(1, Math.round(file.size / 1024))}K
                        </span>
                      </button>
                    ))
                  )}
                </section>
              ))
            )}
          </aside>

          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-surface shadow-card">
            <header className="border-b border-border px-4 py-2.5">
              <span className="block truncate font-mono text-xs text-muted">
                {selected?.rel ?? '未选择文件'}
              </span>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 size={14} className="animate-spin" />
                  读取中…
                </div>
              ) : content === null ? (
                <p className="text-sm text-muted">左侧选择一个文件查看内容。</p>
              ) : isMarkdown ? (
                <MarkdownViewer>{content}</MarkdownViewer>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-text">
                  {content}
                </pre>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
