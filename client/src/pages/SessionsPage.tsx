import type { SessionMeta } from '@workbench/sdk';
import { LogOut, MessageSquare, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { DeviceRequiredCard } from '@/components/DeviceRequiredCard';
import { disconnect, getClient, onReconnect } from '@/lib/connection';

export function SessionsPage({
  onOpenSession,
  onDisconnected,
}: {
  onOpenSession: (id: string) => void;
  onDisconnected: () => void;
}) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** sessionId → "busy"|"retry" (running). Absent = idle. */
  const [running, setRunning] = useState<Record<string, boolean>>({});
  /** sessionId → retry reason (model quota, etc). */
  const [failed, setFailed] = useState<Record<string, string>>({});
  /** Connection health: false when the host is unreachable (SSE offline/error). */
  const [hostOnline, setHostOnline] = useState(true);

  const refresh = useCallback(async () => {
    const client = getClient();
    if (!client) return;
    try {
      setSessions(await client.listSessions());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    // Poll session activity for the running/failed badge.
    try {
      const status = await client.getSessionStatus();
      const run: Record<string, boolean> = {};
      const failed: Record<string, string> = {};
      for (const [id, st] of Object.entries(status)) {
        if (st.type === 'busy') run[id] = true;
        else if (st.type === 'retry') failed[id] = st.message ?? '模型调用失败';
      }
      setRunning(run);
      setFailed(failed);
    } catch {
      /* status poll is best-effort */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 8000);
    const unsub = onReconnect(() => {
      setHostOnline(true);
      void refresh();
    });
    // Track SSE health: offline/error means the host dropped; reconnect logic
    // in the SDK will bring it back with backoff.
    const client = getClient();
    const unsubStatus = client?.onStatus((s) => {
      setHostOnline(s === 'ready');
    });
    return () => {
      clearInterval(t);
      unsub();
      unsubStatus?.();
    };
  }, [refresh]);

  const create = async () => {
    const client = getClient();
    if (!client || busy) return;
    setBusy(true);
    try {
      const id = await client.createSession();
      onOpenSession(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const client = getClient();
    if (!client) return;
    try {
      await client.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** Switch host is handled by the global DeviceBar; this page no longer
   *  renders its own modal. Logout stays here as a convenience. */
  const logout = () => {
    disconnect();
    onDisconnected();
  };

  if (!getClient()) {
    return <DeviceRequiredCard />;
  }

  return (
    <div className="page">
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 16px 8px' }}>
        <MessageSquare size={18} style={{ color: 'var(--accent)' }} />
        <h1 style={{ fontSize: 17, fontWeight: 600, flex: 1 }}>会话</h1>
        <button
          onClick={() => void refresh()}
          aria-label="刷新"
          style={{ padding: 6, color: 'var(--muted)' }}
        >
          <RefreshCw size={16} />
        </button>
        <button
          onClick={logout}
          aria-label="断开连接"
          style={{ padding: 6, color: 'var(--muted)' }}
        >
          <LogOut size={16} />
        </button>
      </header>

      {!hostOnline && (
        <div
          style={{
            margin: '0 16px 8px',
            padding: '8px 12px',
            borderRadius: 9,
            background: 'color-mix(in srgb, var(--warn) 12%, transparent)',
            border: '1px solid var(--warn)',
            color: 'var(--warn)',
            fontSize: 12.5,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--warn)',
              animation: 'pulse 1.2s infinite',
              flexShrink: 0,
            }}
          />
          主机离线，正在自动重连…
        </div>
      )}

      <div style={{ padding: '4px 16px' }}>
        <button
          className="btn-primary"
          style={{ width: '100%' }}
          onClick={() => void create()}
          disabled={busy}
        >
          <Plus size={15} /> 新建会话
        </button>
      </div>

      {error && <p style={{ color: 'var(--error)', fontSize: 13, padding: '8px 16px' }}>{error}</p>}

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 24px' }}>
        {sessions.length === 0 && (
          <p style={{ color: 'var(--muted)', textAlign: 'center', paddingTop: 48, fontSize: 14 }}>
            暂无会话，点击上方「新建会话」开始
          </p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 10px',
              borderRadius: 10,
              marginBottom: 6,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <button
              onClick={() => onOpenSession(s.id)}
              style={{ flex: 1, textAlign: 'left', minWidth: 0 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {s.title || '未命名会话'}
                </span>
                {running[s.id] && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      flexShrink: 0,
                      padding: '1px 7px',
                      borderRadius: 999,
                      fontSize: 11,
                      color: 'var(--ok)',
                      background: 'color-mix(in srgb, var(--ok) 12%, transparent)',
                      border: '1px solid var(--ok)',
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: 'var(--ok)',
                        animation: 'pulse 1.2s infinite',
                      }}
                    />
                    运行中
                  </span>
                )}
                {failed[s.id] && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      flexShrink: 0,
                      padding: '1px 7px',
                      borderRadius: 999,
                      fontSize: 11,
                      color: 'var(--error)',
                      background: 'color-mix(in srgb, var(--error) 12%, transparent)',
                      border: '1px solid var(--error)',
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: 'var(--error)',
                      }}
                    />
                    失败
                  </span>
                )}
              </div>
              {s.directory && (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--muted)',
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {s.directory}
                </div>
              )}
              {s.updatedAt != null && (
                <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2, opacity: 0.8 }}>
                  {new Date(s.updatedAt).toLocaleString(undefined, {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              )}
            </button>
            <button
              onClick={() => void remove(s.id)}
              aria-label="删除会话"
              style={{ padding: 6, color: 'var(--muted)' }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
