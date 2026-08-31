import {
  ChevronRight,
  FileText,
  Folder,
  Image as ImageIcon,
  Loader2,
  NotebookPen,
  Sheet,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { FilePreviewInspector } from '@/components/inspector/FilePreviewInspector';
import { baseName } from '@/components/thread/WorkspaceChip';
import { type DirEntry, listDir } from '@/lib/artifactFile';
import { extOf, extToKind, type PreviewKind, previewKindForName } from '@/lib/artifacts';
import { cn } from '@/lib/cn';
import { useRuntimeStore } from '@/lib/runtime';
import { isTauri, workspaceBase } from '@/lib/tauri';

const EXT_LANG: Record<string, string> = {
  py: 'python',
  r: 'r',
  jl: 'julia',
  sh: 'bash',
  tex: 'latex',
  md: 'markdown',
};

function iconFor(entry: DirEntry) {
  if (entry.isDir) return <Folder size={15} className="text-accent" />;
  const kind = previewKindForName(entry.name);
  const cls = 'text-muted';
  if (entry.name.endsWith('.ipynb')) return <NotebookPen size={15} className={cls} />;
  if (kind === 'image') return <ImageIcon size={15} className={cls} />;
  if (kind === 'table') return <Sheet size={15} className={cls} />;
  return <FileText size={15} className={cls} />;
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * GLOBAL file explorer: browses from the base folder (Settings → Workspace),
 * which holds every session's dated folder — not the active session only.
 * Directories are navigable via a breadcrumb; files open in the same viewers
 * used elsewhere (figures, tables, PDF, notebooks),
 * so all past work is reachable in one place.
 */
export function FilesPage() {
  const [dir, setDir] = useState(''); // base-relative; "" = the base folder
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DirEntry | null>(null);
  // The base folder's path, for the root crumb (name + full path on hover).
  const [basePath, setBasePath] = useState<string | null>(null);
  useEffect(() => {
    void workspaceBase()
      .then(setBasePath)
      .catch(() => {});
  }, []);

  const load = useCallback(async (rel: string) => {
    setEntries(null);
    setError(null);
    try {
      setEntries(await listDir(rel, 'base'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void load(dir);
  }, [dir, load]);

  const open = (entry: DirEntry) => {
    if (entry.isDir) {
      setSelected(null);
      setDir(entry.path);
    } else {
      setSelected(entry);
    }
  };

  const crumbs = dir ? dir.split('/') : [];

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-3 py-2.5 text-[13px]">
          <button
            className={cn(
              'rounded px-1 hover:bg-surface-2',
              dir ? 'text-link' : 'font-medium text-text',
            )}
            onClick={() => setDir('')}
            title={basePath ?? undefined}
          >
            {baseName(basePath)}
          </button>
          {crumbs.map((part, i) => {
            const to = crumbs.slice(0, i + 1).join('/');
            const isLast = i === crumbs.length - 1;
            return (
              <span key={to} className="flex items-center gap-0.5">
                <ChevronRight size={13} className="text-muted" />
                <button
                  className={cn(
                    'rounded px-1 hover:bg-surface-2',
                    isLast ? 'font-medium text-text' : 'text-link',
                  )}
                  onClick={() => setDir(to)}
                >
                  {part}
                </button>
              </span>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {entries === null && (
            <div className="flex items-center gap-2 p-2 text-sm text-muted">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          )}
          {error && <div className="p-2 text-sm text-error">{error}</div>}
          {entries && entries.length === 0 && !error && (
            <div className="p-2 text-sm text-muted">
              {isTauri
                ? 'This folder is empty.'
                : 'The file explorer is available in the desktop app.'}
            </div>
          )}
          {entries?.map((entry) => (
            <button
              key={entry.path}
              onClick={() => open(entry)}
              className={cn(
                'flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left text-[13px] hover:bg-surface-2',
                selected?.path === entry.path ? 'bg-surface-2 text-text' : 'text-text/90',
              )}
            >
              {iconFor(entry)}
              <span className="flex-1 truncate">{entry.name}</span>
              {!entry.isDir && (
                <span className="shrink-0 text-[11px] text-muted">{humanSize(entry.size)}</span>
              )}
              {entry.isDir && <ChevronRight size={14} className="shrink-0 text-muted" />}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {selected ? (
          <FilePreview
            key={selected.path}
            entry={selected}
            root="base"
            onClose={() => setSelected(null)}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted">
            Select a file to preview it here.
          </div>
        )}
      </div>
    </div>
  );
}

function FilePreview({
  entry,
  root,
  onClose,
}: {
  entry: DirEntry;
  root: 'workspace' | 'base';
  onClose: () => void;
}) {
  const ext = extOf(entry.name);
  const kind: PreviewKind = previewKindForName(entry.name);
  return (
    <FilePreviewInspector
      data={{
        variant: 'file',
        path: entry.path,
        filename: entry.name,
        artifact: extToKind(ext),
        language: EXT_LANG[ext] ?? (kind === 'text' ? ext : undefined),
        root,
      }}
      onClose={onClose}
    />
  );
}

/**
 * Compact browser for the CURRENT session's folder, shown in the right
 * inspector pane beside the conversation (the session-scoped quick entry —
 * the Files page itself is global). Clicking a file swaps the pane to its
 * preview; closing the preview returns to the list.
 */
export function SessionFilesPane({ onClose }: { onClose: () => void }) {
  const workspace = useRuntimeStore((s) => s.workspace);
  const [dir, setDir] = useState('');
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DirEntry | null>(null);

  // A session switch moves the active folder — restart at its root.
  useEffect(() => {
    setSelected(null);
    setDir('');
  }, [workspace]);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    listDir(dir, 'workspace')
      .then((e) => {
        if (!cancelled) setEntries(e);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setEntries([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dir, workspace]);

  if (selected) {
    return <FilePreview entry={selected} root="workspace" onClose={() => setSelected(null)} />;
  }

  const crumbs = dir ? dir.split('/') : [];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Folder size={14} className="shrink-0 text-muted" />
        <span className="truncate text-sm font-medium text-text" title={workspace ?? undefined}>
          {baseName(workspace)}
        </span>
        <span className="text-xs text-muted">当前会话文件夹</span>
        <div className="flex-1" />
        <button className="text-muted hover:text-text" aria-label="关闭文件" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {crumbs.length > 0 && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-3 py-2 text-[12px]">
          <button className="rounded px-1 text-link hover:bg-surface-2" onClick={() => setDir('')}>
            {baseName(workspace)}
          </button>
          {crumbs.map((part, i) => {
            const to = crumbs.slice(0, i + 1).join('/');
            const isLast = i === crumbs.length - 1;
            return (
              <span key={to} className="flex items-center gap-0.5">
                <ChevronRight size={12} className="text-muted" />
                <button
                  className={cn(
                    'rounded px-1 hover:bg-surface-2',
                    isLast ? 'font-medium text-text' : 'text-link',
                  )}
                  onClick={() => setDir(to)}
                >
                  {part}
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {entries === null && (
          <div className="flex items-center gap-2 p-2 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        )}
        {error && <div className="p-2 text-sm text-error">{error}</div>}
        {entries && entries.length === 0 && !error && (
          <div className="p-2 text-sm text-muted">This folder is empty.</div>
        )}
        {entries?.map((entry) => (
          <button
            key={entry.path}
            onClick={() => (entry.isDir ? setDir(entry.path) : setSelected(entry))}
            className="flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left text-[13px] text-text/90 hover:bg-surface-2"
          >
            {iconFor(entry)}
            <span className="flex-1 truncate">{entry.name}</span>
            {!entry.isDir && (
              <span className="shrink-0 text-[11px] text-muted">{humanSize(entry.size)}</span>
            )}
            {entry.isDir && <ChevronRight size={14} className="shrink-0 text-muted" />}
          </button>
        ))}
      </div>
    </div>
  );
}
