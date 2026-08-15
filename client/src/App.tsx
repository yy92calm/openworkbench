import { useEffect, useState } from "react";
import { connect, isConnected, loadConfig, getClient } from "@/lib/connection";
import { ConnectPage } from "@/pages/ConnectPage";
import { SessionsPage } from "@/pages/SessionsPage";
import { SessionPage } from "@/pages/SessionPage";

export function App() {
  const [ready, setReady] = useState(isConnected());
  const [trying, setTrying] = useState(!isConnected());
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Auto-reconnect from the saved config on reload; only show the connect form
  // when there is nothing saved or the connection fails.
  useEffect(() => {
    if (isConnected()) return;
    const cfg = loadConfig();
    if (!cfg) {
      setTrying(false);
      return;
    }
    connect(cfg)
      .then(() => setReady(true))
      .catch(() => setReady(false))
      .finally(() => setTrying(false));
  }, []);

  if (trying) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 14 }}>
        正在连接…
      </div>
    );
  }
  if (!ready) {
    return <ConnectPage onConnected={() => setReady(true)} />;
  }
  if (!getClient()) return null; // ready implies a live client
  if (sessionId) {
    return <SessionPage sessionId={sessionId} onBack={() => setSessionId(null)} />;
  }
  return <SessionsPage onOpenSession={(id) => setSessionId(id)} onDisconnected={() => setReady(false)} />;
}
