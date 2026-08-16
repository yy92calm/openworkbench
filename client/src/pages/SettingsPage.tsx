import { useCallback, useEffect, useState } from "react";
import { RadioTower, Copy, Check, LogOut } from "lucide-react";
import type { RelayHostStatusInfo } from "@workbench/sdk";
import { getHostClient, isConnected, loadConfig, disconnect, openDeviceSheet } from "@/lib/connection";

const STATUS_LABEL: Record<RelayHostStatusInfo["status"], string> = {
  off: "未连接",
  connecting: "连接中…",
  connected: "已连接",
  error: "连接失败",
};

const STATUS_COLOR: Record<RelayHostStatusInfo["status"], string> = {
  off: "var(--muted)",
  connecting: "var(--warn)",
  connected: "var(--ok)",
  error: "var(--error)",
};

interface Props {
  onDisconnected?: () => void;
}

export function SettingsPage({ onDisconnected }: Props) {
  const [status, setStatus] = useState<RelayHostStatusInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const cfg = loadConfig();

  const refresh = useCallback(async () => {
    if (!isConnected()) {
      setLoading(false);
      return;
    }
    try {
      setStatus(await getHostClient().getRelayStatus());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isConnected()) {
      setLoading(false);
      return;
    }
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const copyDeviceId = async () => {
    if (!status?.config.deviceId) return;
    try {
      await navigator.clipboard.writeText(status.config.deviceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const logout = () => {
    disconnect();
    onDisconnected?.();
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">设置</h1>
      </header>

      {error && <div className="page-error">{error}</div>}

      <div className="settings-card">
        <div className="settings-card-head">
          <RadioTower size={18} style={{ color: "var(--accent)" }} />
          <span className="settings-card-title">Relay 连接</span>
          {status && (
            <span className="status-badge" style={{ color: STATUS_COLOR[status.status] }}>
              <span className="status-dot" style={{ background: STATUS_COLOR[status.status] }} />
              {STATUS_LABEL[status.status]}
            </span>
          )}
        </div>

        {!isConnected() ? (
          <div className="settings-row">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>未选择设备</span>
              <button className="btn-primary" onClick={() => openDeviceSheet()}>
                <RadioTower size={15} /> 选择设备
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="settings-row">加载中…</div>
        ) : status ? (
          <>
            <div className="settings-row">
              <label>Relay URL</label>
              <div className="settings-value mono">{status.config.relayUrl || "—"}</div>
            </div>
            <div className="settings-row">
              <label>Device ID</label>
              <div className="settings-value-row">
                <span className="settings-value mono">{status.config.deviceId || "—"}</span>
                {status.config.deviceId && (
                  <button onClick={() => void copyDeviceId()} className="icon-btn small" aria-label="复制">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                )}
              </div>
            </div>
            <div className="settings-row">
              <label>Token</label>
              <div className="settings-value mono">{status.config.tokenSet ? "已配置" : "未配置"}</div>
            </div>
          </>
        ) : (
          <div className="settings-row">无法获取状态</div>
        )}
      </div>

      {cfg && (
        <div className="settings-section">
          <div className="settings-section-title">当前账号</div>
          <div className="settings-row">
            <label>Relay URL</label>
            <div className="settings-value mono">{cfg.relayUrl}</div>
          </div>
          <div className="settings-row">
            <label>Device</label>
            <div className="settings-value mono">{cfg.deviceId || "—"}</div>
          </div>
        </div>
      )}

      <div className="settings-section">
        <button onClick={logout} className="btn-ghost danger full-width">
          <LogOut size={16} /> 断开连接
        </button>
      </div>
    </div>
  );
}
