import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, File as FileIcon, FileText, Folder, ImageIcon, NotebookPen, Sheet, FolderCog } from "lucide-react";
import type { DirEntry, WorkspaceInfo } from "@workbench/sdk";
import { getHostClient, isConnected } from "@/lib/connection";
import { DeviceRequiredCard } from "@/components/DeviceRequiredCard";

interface Props {
  onOpenFile: (path: string, root?: string) => void;
  onSwitchWorkspace: () => void;
}

interface StackFrame {
  rel: string;
  name: string;
}

function iconFor(entry: DirEntry) {
  if (entry.is_dir) return <Folder size={18} style={{ color: "var(--accent)" }} />;
  const ext = entry.name.split(".").pop()?.toLowerCase();
  if (ext === "ipynb") return <NotebookPen size={18} style={{ color: "var(--muted)" }} />;
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext ?? "")) return <ImageIcon size={18} style={{ color: "var(--muted)" }} />;
  if (["csv", "tsv", "xlsx", "xls"].includes(ext ?? "")) return <Sheet size={18} style={{ color: "var(--muted)" }} />;
  if (["md", "txt", "json", "ts", "js", "tsx", "jsx", "py", "go", "rs", "sh"].includes(ext ?? "")) return <FileText size={18} style={{ color: "var(--muted)" }} />;
  return <FileIcon size={18} style={{ color: "var(--muted)" }} />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.floor(bytes / 1024)}K`;
  return `${Math.floor(bytes / (1024 * 1024))}M`;
}

export function FilesPage({ onOpenFile, onSwitchWorkspace }: Props) {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [stack, setStack] = useState<StackFrame[]>([]);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const currentRel = stack.map((f) => f.name).join("/");

  const refresh = useCallback(async () => {
    try {
      const host = getHostClient();
      if (!workspace) {
        const ws = await host.getWorkspace();
        setWorkspace(ws);
      }
      setEntries(await host.listDir(currentRel));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [currentRel, workspace]);

  useEffect(() => {
    if (!isConnected()) return;
    void refresh();
  }, [refresh]);

  if (!isConnected()) {
    return <DeviceRequiredCard />;
  }

  const enterDir = (name: string) => {
    setStack((s) => [...s, { rel: s.map((f) => f.name).join("/") + "/" + name, name }]);
  };

  const goBack = () => {
    setStack((s) => s.slice(0, -1));
  };

  const jumpTo = (idx: number) => {
    setStack((s) => s.slice(0, idx + 1));
  };

  return (
    <div className="page">
      <header className="page-header">
        {stack.length > 0 ? (
          <button onClick={goBack} className="icon-btn" aria-label="返回">
            <ArrowLeft size={18} />
          </button>
        ) : (
          <span style={{ width: 18 }} />
        )}
        <h1 className="page-title">{stack.length > 0 ? stack[stack.length - 1].name : "文件"}</h1>
      </header>

      {stack.length > 0 && (
        <div className="breadcrumbs">
          <button className="crumb" onClick={() => setStack([])}>根</button>
          {stack.map((f, i) => (
            <span key={i} className="crumb-item">
              <span className="crumb-sep">/</span>
              <button className="crumb" onClick={() => jumpTo(i)}>{f.name}</button>
            </span>
          ))}
        </div>
      )}

      {workspace && stack.length === 0 && (
        <button className="workspace-info" onClick={onSwitchWorkspace}>
          <div className="workspace-info-row">
            <FolderCog size={16} style={{ color: "var(--accent)" }} />
            <div className="workspace-info-text">
              <div className="workspace-label">当前工作区</div>
              <div className="workspace-path mono">{workspace.current}</div>
            </div>
            <ArrowLeft size={14} style={{ color: "var(--muted)", transform: "rotate(180deg)" }} />
          </div>
        </button>
      )}

      {error && <div className="page-error">{error}</div>}

      {loading ? (
        <div className="page-empty">加载中…</div>
      ) : entries.length === 0 ? (
        <div className="page-empty">此文件夹为空</div>
      ) : (
        <div className="file-list">
          {/* Directories first, then files, both alphabetical */}
          {[...entries].sort((a, b) => {
            if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
            return a.name.localeCompare(b.name);
          }).map((entry) => (
            <button
              key={entry.name}
              className="file-item"
              onClick={() => entry.is_dir ? enterDir(entry.name) : onOpenFile(currentRel ? `${currentRel}/${entry.name}` : entry.name)}
            >
              {iconFor(entry)}
              <span className="file-name">{entry.name}</span>
              {entry.is_file && entry.size > 0 && (
                <span className="file-size">{formatSize(entry.size)}</span>
              )}
              {entry.is_dir && <ArrowLeft size={14} style={{ color: "var(--muted)", transform: "rotate(180deg)" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
