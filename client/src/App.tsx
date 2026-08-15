import { useEffect, useState } from "react";
import { connect, isConnected, loadConfig, getClient } from "@/lib/connection";
import { ConnectPage } from "@/pages/ConnectPage";
import { SessionsPage } from "@/pages/SessionsPage";
import { SessionPage } from "@/pages/SessionPage";
import { TasksPage } from "@/pages/TasksPage";
import { TaskFormPage } from "@/pages/TaskFormPage";
import { HistoryPage } from "@/pages/HistoryPage";
import { FilesPage } from "@/pages/FilesPage";
import { FilePreviewPage } from "@/pages/FilePreviewPage";
import { WorkspaceSwitchPage } from "@/pages/WorkspaceSwitchPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TabBar, type TabKey } from "@/components/TabBar";

/** Stack entry for pages pushed on top of a tab (e.g. session view, task form,
 *  file preview). Each entry knows how to render itself and how to go back. */
type StackEntry =
  | { kind: "session"; sessionId: string }
  | { kind: "task-form"; taskId?: string }
  | { kind: "history"; taskId: string; taskName: string }
  | { kind: "file-preview"; path: string; root?: string }
  | { kind: "workspace-switch" };

export function App() {
  const [ready, setReady] = useState(isConnected());
  const [trying, setTrying] = useState(!isConnected());
  const [tab, setTab] = useState<TabKey>("sessions");
  const [stack, setStack] = useState<StackEntry[]>([]);

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

  const push = (entry: StackEntry) => setStack((s) => [...s, entry]);
  const pop = () => setStack((s) => s.slice(0, -1));

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

  // Render the top of the stack (a pushed page) over the current tab.
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    let page: React.ReactNode;
    switch (top.kind) {
      case "session":
        page = <SessionPage sessionId={top.sessionId} onBack={pop} />;
        break;
      case "task-form":
        page = (
          <TaskFormPage
            taskId={top.taskId}
            onDone={pop}
          />
        );
        break;
      case "history":
        page = <HistoryPage taskId={top.taskId} taskName={top.taskName} onBack={pop} />;
        break;
      case "file-preview":
        page = <FilePreviewPage path={top.path} root={top.root} onBack={pop} />;
        break;
      case "workspace-switch":
        page = <WorkspaceSwitchPage onBack={pop} />;
        break;
    }
    return <div className="app-shell">{page}</div>;
  }

  // Tab root pages.
  let page: React.ReactNode;
  switch (tab) {
    case "sessions":
      page = <SessionsPage onOpenSession={(id) => push({ kind: "session", sessionId: id })} onDisconnected={() => setReady(false)} />;
      break;
    case "tasks":
      page = (
        <TasksPage
          onNew={() => push({ kind: "task-form" })}
          onEdit={(id) => push({ kind: "task-form", taskId: id })}
          onHistory={(taskId, taskName) => push({ kind: "history", taskId, taskName })}
        />
      );
      break;
    case "files":
      page = (
        <FilesPage
          onOpenFile={(path, root) => push({ kind: "file-preview", path, root })}
          onSwitchWorkspace={() => push({ kind: "workspace-switch" })}
        />
      );
      break;
    case "settings":
      page = <SettingsPage onDisconnected={() => setReady(false)} />;
      break;
  }

  return (
    <div className="app-shell">
      <div className="tab-content">{page}</div>
      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}
