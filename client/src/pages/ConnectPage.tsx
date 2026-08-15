import { useEffect, useMemo, useState } from "react";
import { Radio, RadioTower, RefreshCw } from "lucide-react";
import { connect, listDevices, loadConfig, saveConfig, type RelayDeviceInfo } from "@/lib/connection";

export function ConnectPage({ onConnected }: { onConnected: () => void }) {
  const [relayUrl, setRelayUrl] = useState("");
  const [token, setToken] = useState("");
  const [devices, setDevices] = useState<RelayDeviceInfo[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Online devices first, then registration order (already sorted by device id).
  const sortedDevices = useMemo(
    () => [...(devices ?? [])].sort((a, b) => Number(b.online) - Number(a.online)),
    [devices],
  );

  // Restore the previous session's relay + token and, if a device was already
  // picked, jump straight to connecting; otherwise auto-fetch the device list.
  useEffect(() => {
    const cfg = loadConfig();
    if (!cfg) return;
    setRelayUrl(cfg.relayUrl);
    setToken(cfg.token);
    if (cfg.deviceId) {
      setSelected(cfg.deviceId);
      void submit(cfg.relayUrl, cfg.token, cfg.deviceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchDevices = async () => {
    setBusy(true);
    setError("");
    try {
      const list = await listDevices(relayUrl, token);
      setDevices(list);
      // Auto-select only when there is exactly one online device — never
      // silently pick an offline one.
      const online = list.filter((d) => d.online);
      setSelected(list.length === 1 && online.length === 1 ? list[0].device : "");
      if (list.length === 0) setError("该账号还没有注册任何设备——请先在桌面端设置 → 远程访问 中开启连接。");
    } catch (err) {
      setDevices(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (url: string = relayUrl, tok: string = token, device: string = selected) => {
    setBusy(true);
    setError("");
    try {
      await connect({ relayUrl: url, deviceId: device, token: tok });
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Step 2 (device picker) is only shown once the token passed authentication.
  const showPicker = devices !== null;

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <RadioTower size={20} style={{ color: "var(--accent)" }} />
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Workbench Remote</h1>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 24 }}>
          使用账号令牌登录，选择一台桌面端设备后查看与继续会话。
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {!showPicker ? (
            <>
              <div className="field">
                <label>中继服务器（ws:// 或 wss://）</label>
                <input value={relayUrl} onChange={(e) => setRelayUrl(e.target.value)} placeholder="ws://your-server:8080" spellCheck={false} inputMode="url" />
              </div>
              <div className="field">
                <label>账号令牌（桌面端管理分配的登录凭证）</label>
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="令牌" />
              </div>
              {error && <p style={{ color: "var(--error)", fontSize: 13 }}>{error}</p>}
              <button
                className="btn-primary"
                disabled={busy || !relayUrl || !token}
                onClick={() => void fetchDevices()}
              >
                <Radio size={15} />
                {busy ? "验证中…" : "登录并查看设备"}
              </button>
            </>
          ) : (
            <>
              <div className="field">
                <label>选择要连接的设备{devices.length > 0 && `（${devices.filter((d) => d.online).length} 台在线）`}</label>
                {devices.length === 0 ? (
                  <p style={{ color: "var(--muted)", fontSize: 13 }}>该账号还没有注册任何设备。</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                    {sortedDevices.map((d) => (
                      <label
                        key={d.device}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: `1px solid ${selected === d.device ? "var(--accent)" : "var(--border)"}`,
                          cursor: "pointer",
                          fontSize: 13,
                          opacity: d.online ? 1 : 0.6,
                        }}
                      >
                        <input
                          type="radio"
                          name="device"
                          checked={selected === d.device}
                          onChange={() => setSelected(d.device)}
                          style={{ accentColor: "var(--accent)" }}
                        />
                        <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis" }}>{d.device}</span>
                        <span
                          style={{
                            marginLeft: "auto",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 12,
                            color: d.online ? "var(--ok)" : "var(--muted)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span
                            style={{
                              height: 7,
                              width: 7,
                              borderRadius: "50%",
                              background: d.online ? "var(--ok)" : "var(--muted)",
                            }}
                          />
                          {d.online ? "在线" : "离线"}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {error && <p style={{ color: "var(--error)", fontSize: 13 }}>{error}</p>}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn-primary" disabled={busy || !selected} onClick={() => void submit()}>
                  <Radio size={15} />
                  {busy ? "连接中…" : "连接"}
                </button>
                <button className="btn-secondary" disabled={busy} onClick={() => void fetchDevices()}>
                  <RefreshCw size={14} />
                  刷新
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}