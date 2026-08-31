import type { DirEntry, WorkspaceInfo } from '@workbench/sdk';
import { ArrowLeft, Check, Folder, FolderCog, FolderPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { getHostClient } from '@/lib/connection';

interface Props {
  onBack: () => void;
  /** Called after a successful switch — caller usually pops the page. */
  onSwitched?: () => void;
}

/** Workspace switcher: lists subdirectories under the base workspace so the
 *  user can pick one, plus a "new dated folder" shortcut. The selected path
 *  is written through `host.setWorkspace`, which updates the active workspace
 *  file on the desktop side. New sessions created afterwards use the new path;
 *  the sidecar itself is not restarted. */
export function WorkspaceSwitchPage({ onBack, onSwitched }: Props) {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [showNew, setShowNew] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const host = getHostClient();
      const ws = await host.getWorkspace();
      setWorkspace(ws);
      // List base workspace root (rel="") to show sibling folders.
      setEntries(await host.listDir('', 'base'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pick = async (path: string) => {
    setBusy(true);
    setError('');
    try {
      await getHostClient().setWorkspace(path);
      onSwitched?.();
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const createAndPick = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      await getHostClient().newDatedWorkspace(name);
      onSwitched?.();
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const dirs = entries.filter((e) => e.is_dir).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="page">
      <header className="page-header">
        <button onClick={onBack} className="icon-btn" aria-label="返回">
          <ArrowLeft size={18} />
        </button>
        <h1 className="page-title">切换工作区</h1>
        <button
          onClick={() => setShowNew((v) => !v)}
          className="icon-btn accent"
          aria-label="新建文件夹"
          title="新建文件夹"
        >
          <FolderPlus size={18} />
        </button>
      </header>

      {workspace && (
        <div className="workspace-info static">
          <div className="workspace-info-row">
            <FolderCog size={16} style={{ color: 'var(--accent)' }} />
            <div className="workspace-info-text">
              <div className="workspace-label">当前</div>
              <div className="workspace-path mono">{workspace.current}</div>
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <div className="inline-form">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新文件夹名称"
            className="inline-input"
            disabled={busy}
          />
          <button
            className="btn-primary small"
            disabled={busy || !newName.trim()}
            onClick={() => void createAndPick()}
          >
            创建并切换
          </button>
        </div>
      )}

      {error && <div className="page-error">{error}</div>}

      {loading ? (
        <div className="page-empty">加载中…</div>
      ) : dirs.length === 0 ? (
        <div className="page-empty">基础工作区下没有子文件夹</div>
      ) : (
        <div className="file-list">
          {dirs.map((d) => {
            // Resolve absolute path: base + "/" + name. The host stores
            // absolute paths so this matches how setWorkspace expects input.
            const abs = workspace ? `${workspace.base.replace(/\/$/, '')}/${d.name}` : d.name;
            const active = workspace?.current === abs;
            return (
              <button
                key={d.name}
                className={`file-item ${active ? 'active' : ''}`}
                disabled={busy || active}
                onClick={() => void pick(abs)}
              >
                <Folder size={18} style={{ color: active ? 'var(--accent)' : 'var(--accent)' }} />
                <span className="file-name">{d.name}</span>
                {active ? (
                  <Check size={16} style={{ color: 'var(--ok)' }} />
                ) : (
                  <ArrowLeft
                    size={14}
                    style={{ color: 'var(--muted)', transform: 'rotate(180deg)' }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="page-hint">切换后新建会话将使用新工作目录；已打开的会话不受影响。</div>
    </div>
  );
}
