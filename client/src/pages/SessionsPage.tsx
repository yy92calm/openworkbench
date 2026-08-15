import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Plus, Trash2, LogOut, RefreshCw } from "lucide-react";
import type { SessionMeta } from "@workbench/sdk";
import { disconnect, getClient } from "@/lib/connection";

export function SessionsPage({
  onOpenSession,
  onDisconnected,
}: {
  onOpenSession: (id: string) => void;
  onDisconnected: () => void;
}) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const client = getClient();
    if (!client) return;
    try {
      setSessions(await client.listSessions());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
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

  const logout = () => {
    disconnect();
    onDisconnected();
  };

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 16px 8px" }}>
        <MessageSquare size={18} style={{ color: "var(--accent)" }} />
        <h1 style={{ fontSize: 17, fontWeight: 600, flex: 1 }}>会话</h1>
        <button onClick={() => void refresh()} aria-label="刷新" style={{ padding: 6, color: "var(--muted)" }}>
          <RefreshCw size={16} />
        </button>
        <button onClick={logout} aria-label="断开连接" style={{ padding: 6, color: "var(--muted)" }}>
          <LogOut size={16} />
        </button>
      </header>

      <div style={{ padding: "4px 16px" }}>
        <button className="btn-primary" style={{ width: "100%" }} onClick={() => void create()} disabled={busy}>
          <Plus size={15} /> 新建会话
        </button>
      </div>

      {error && <p style={{ color: "var(--error)", fontSize: 13, padding: "8px 16px" }}>{error}</p>}

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px 24px" }}>
        {sessions.length === 0 && (
          <p style={{ color: "var(--muted)", textAlign: "center", paddingTop: 48, fontSize: 14 }}>
            暂无会话，点击上方「新建会话」开始
          </p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 10px",
              borderRadius: 10,
              marginBottom: 6,
              background: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <button
              onClick={() => onOpenSession(s.id)}
              style={{ flex: 1, textAlign: "left", minWidth: 0 }}
            >
              <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.title || "未命名会话"}
              </div>
              {s.directory && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {s.directory}
                </div>
              )}
            </button>
            <button onClick={() => void remove(s.id)} aria-label="删除会话" style={{ padding: 6, color: "var(--muted)" }}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
