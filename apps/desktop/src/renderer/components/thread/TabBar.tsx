import { useNavigate } from "react-router-dom";
import { FileText, MessageSquare, X } from "lucide-react";
import { useUiStore, type Tab } from "@/lib/store";
import { useRuntimeStore } from "@/lib/runtime";
import { cn } from "@/lib/cn";

/**
 * Main-area tab bar. Session tabs switch the active conversation (the agent
 * keeps running in the background); file tabs show an artifact preview.
 * Hidden when there are no tabs (e.g. before the first session).
 */
export function TabBar() {
  const tabs = useUiStore((s) => s.tabs);
  const activeTabId = useUiStore((s) => s.activeTabId);
  const activateTab = useUiStore((s) => s.activateTab);
  const closeTab = useUiStore((s) => s.closeTab);
  const runningSessions = useRuntimeStore((s) => s.runningSessions);
  const sessions = useRuntimeStore((s) => s.sessions);
  const navigate = useNavigate();

  if (tabs.length === 0) return null;

  // Session tab titles follow the live session title (renames update in
  // place); file tabs use the stored file name.
  const tabTitle = (t: Tab): string =>
    t.kind === "session" && t.sessionId
      ? (sessions.find((s) => s.id === t.sessionId)?.title ?? t.title)
      : t.title;

  const onActivate = (tab: Tab) => {
    activateTab(tab.id);
    // Session tabs drive the route so LiveSessionPage opens that conversation.
    if (tab.kind === "session") {
      navigate(tab.sessionId ? `/live/${tab.sessionId}` : "/live");
    }
  };

  // Closing a tab never deletes the underlying session - it only drops the tab.
  // If the closed tab was active and a neighbor session tab takes over, follow
  // it so the main area stays in sync with the highlighted tab. Closing into a
  // file tab (or no tab) leaves the main area as-is; the session stays listed
  // in the sidebar and can be reopened any time.
  const onClose = (e: React.MouseEvent, tab: Tab) => {
    e.stopPropagation();
    const wasActive = tab.id === useUiStore.getState().activeTabId;
    closeTab(tab.id);
    if (wasActive) {
      const after = useUiStore.getState();
      const next = after.tabs.find((t) => t.id === after.activeTabId);
      if (next?.kind === "session") {
        navigate(next.sessionId ? `/live/${next.sessionId}` : "/live");
      }
    }
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-surface px-2">
      {tabs.map((t) => {
        const active = t.id === activeTabId;
        const running = t.kind === "session" && !!t.sessionId && !!runningSessions[t.sessionId];
        return (
          <div
            key={t.id}
            onClick={() => onActivate(t)}
            className={cn(
              "group flex max-w-[200px] cursor-pointer items-center gap-1.5 rounded-t-md px-2.5 py-1.5 text-[12px] transition-colors",
              active ? "bg-bg text-text" : "text-muted hover:bg-surface-2 hover:text-text",
            )}
            title={tabTitle(t)}
          >
            {t.kind === "file" ? <FileText size={12} className="shrink-0" /> : <MessageSquare size={12} className="shrink-0" />}
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", running ? "bg-accent animate-pulse" : "bg-transparent")} />
            <span className="truncate">{tabTitle(t)}</span>
            {t.kind === "file" && (
              <button
                onClick={(e) => onClose(e, t)}
                className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-surface-2 group-hover:opacity-100"
                aria-label={`关闭 ${tabTitle(t)}`}
              >
                <X size={11} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
