import { useCallback, useEffect, useState } from "react";
import { ChevronRight, FileText, Folder, Image as ImageIcon, Loader2, NotebookPen, Sheet, X } from "lucide-react";
import { listDir, type DirEntry } from "@/lib/artifactFile";
import { isTauri } from "@/lib/tauri";
import { useRuntimeStore } from "@/lib/runtime";
import { baseName } from "@/components/thread/WorkspaceChip";
import { refToArtifactBlock } from "@/lib/artifacts";
import { useUiStore } from "@/lib/store";
import { cn } from "@/lib/cn";

function iconFor(entry: DirEntry) {
  if (entry.isDir) return <Folder size={14} className="text-accent" />;
  const cls = "text-muted";
  if (entry.name.endsWith(".ipynb")) return <NotebookPen size={14} className={cls} />;
  if (entry.name.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i)) return <ImageIcon size={14} className={cls} />;
  if (entry.name.match(/\.(csv|xlsx?)$/i)) return <Sheet size={14} className={cls} />;
  return <FileText size={14} className={cls} />;
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * File browser panel for the right sidebar.
 * Browses from the active workspace folder and follows workspace switches,
 * so the list always shows what the current session's files live next to.
 * Clicking a file opens it as a main-area preview tab (not an in-dock
 * preview) so md/text/images show in the main surface alongside the
 * conversation.
 */
export function FileBrowserPanel({ onClose }: { onClose: () => void }) {
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [basePath, setBasePath] = useState<string | null>(null);
  const workspace = useRuntimeStore((s) => s.workspace);
  const openFileTab = useUiStore((s) => s.openFileTab);

  useEffect(() => {
    setBasePath(workspace);
  }, [workspace]);

  const load = useCallback(async (rel: string) => {
    setEntries(null);
    setError(null);
    try {
      setEntries(await listDir(rel));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void load(dir);
  }, [dir, load]);

  // When the active workspace changes, drop any subdirectory we were browsing
  // (it belongs to the old folder) and show the new folder's root.
  useEffect(() => {
    setDir("");
  }, [workspace]);

  const crumbs = dir ? dir.split("/") : [];

  const openEntry = (entry: DirEntry) => {
    if (entry.isDir) setDir(entry.path);
    else openFileTab(refToArtifactBlock(entry.path), "workspace");
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[11px] font-medium text-muted">文件</span>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text">
          <X size={13} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5 text-[11px]">
        <button
          className={cn("rounded px-1 hover:bg-surface-2", dir ? "text-link" : "font-medium text-text")}
          onClick={() => setDir("")}
          title={basePath ?? undefined}
        >
          {baseName(basePath)}
        </button>
        {crumbs.map((part, i) => {
          const to = crumbs.slice(0, i + 1).join("/");
          return (
            <span key={to} className="flex items-center gap-0.5">
              <ChevronRight size={10} className="text-muted" />
              <button
                className={cn("rounded px-1 hover:bg-surface-2", i === crumbs.length - 1 ? "font-medium text-text" : "text-link")}
                onClick={() => setDir(to)}
              >
                {part}
              </button>
            </span>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {entries === null && (
          <div className="flex items-center gap-2 p-2 text-xs text-muted">
            <Loader2 size={12} className="animate-spin" /> 加载中…
          </div>
        )}
        {error && <div className="p-2 text-xs text-error">{error}</div>}
        {entries && entries.length === 0 && !error && (
          <div className="p-2 text-xs text-muted">
            {isTauri ? "此文件夹为空。" : "文件浏览器仅在桌面端可用。"}
          </div>
        )}
        {entries?.map((entry) => (
          <button
            key={entry.path}
            onClick={() => openEntry(entry)}
            className="flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left text-xs hover:bg-surface-2"
          >
            {iconFor(entry)}
            <span className="flex-1 truncate text-text">{entry.name}</span>
            {!entry.isDir && <span className="shrink-0 text-[10px] text-muted">{humanSize(entry.size)}</span>}
            {entry.isDir && <ChevronRight size={12} className="shrink-0 text-muted" />}
          </button>
        ))}
      </div>
    </div>
  );
}
