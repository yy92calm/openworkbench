import { useEffect, useState } from "react";
import { RadioTower, ChevronRight } from "lucide-react";
import {
  getClient,
  isConnected,
  loadConfig,
  onOpenDeviceSheet,
  onReconnect,
} from "@/lib/connection";
import { DeviceSheet } from "./DeviceSheet";

/** Global top bar showing the current device status. Clicking it opens the
 *  DeviceSheet for picking / switching devices. Subscribes to the
 *  openDeviceSheet event bus so any tab's "请先选择设备" CTA can trigger it. */
export function DeviceBar() {
  const [, setTick] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const cfg = loadConfig();

  // Re-render when connection state changes (manual connect, reconnect,
  // disconnect). The simplest portable signal is the onReconnect callback; we
  // also poll a short interval since connect() is fire-and-forget from
  // DeviceSheet — a tiny 500ms interval catches the state flip without
  // needing a formal event emitter.
  useEffect(() => {
    const unsub = onReconnect(() => setTick((n) => n + 1));
    const unsubOpen = onOpenDeviceSheet(() => setSheetOpen(true));
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => {
      unsub();
      unsubOpen();
      clearInterval(t);
    };
  }, []);

  const connected = isConnected();
  const client = getClient();
  // Best-effort online signal: SDK flips status to "ready" once SSE opens.
  const [hostReady, setHostReady] = useState(false);
  useEffect(() => {
    const unsub = client?.onStatus((s) => setHostReady(s === "ready"));
    return () => unsub?.();
  }, [client]);

  const open = () => setSheetOpen(true);

  if (!cfg) return null;

  return (
    <>
      <button
        className={`device-bar ${connected ? "connected" : "not-selected"}`}
        onClick={open}
      >
        <RadioTower size={14} style={{ flexShrink: 0 }} />
        {connected ? (
          <>
            <span className="device-bar-id">{cfg.deviceId}</span>
            <span
              className="device-bar-status"
              style={{ color: hostReady ? "var(--ok)" : "var(--warn)" }}
              title={hostReady ? "已连接到设备" : "设备已选，但主机离线 — 正在自动重连，上线后自动恢复"}
            >
              <span
                className="device-bar-dot"
                style={{ background: hostReady ? "var(--ok)" : "var(--warn)" }}
              />
              {hostReady ? "在线" : "主机离线 · 重连中"}
            </span>
          </>
        ) : (
          <>
            <span className="device-bar-id">未选择设备</span>
            <span className="device-bar-cta">点击选择</span>
          </>
        )}
        <ChevronRight size={14} style={{ marginLeft: "auto", color: "var(--muted)", flexShrink: 0 }} />
      </button>
      <DeviceSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}
