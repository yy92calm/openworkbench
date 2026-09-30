import { FileText, MessageSquare, X } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { cn } from '@/lib/cn';
import { rootSessionOf, useRuntimeStore } from '@/lib/runtime';
import { type Tab, useUiStore } from '@/lib/store';

/**
 * Main-area tab bar. Session tabs switch the active conversation (the agent
 * keeps running in the background); file tabs show an artifact preview.
 * Hidden when there are no tabs (e.g. before the first session).
 *
 * Tabs are keyboard-drivable: Cmd/Ctrl+1..9 jumps to the nth tab, Ctrl+Tab /
 * Ctrl+Shift+Tab cycles, and a middle click closes (browser convention).
 * Cmd+W is deliberately NOT bound: macOS's default application menu owns it
 * (close window) and consumes the key before the renderer sees it.
 */
export function TabBar() {
  const tabs = useUiStore((s) => s.tabs);
  const activeTabId = useUiStore((s) => s.activeTabId);
  const closeTab = useUiStore((s) => s.closeTab);
  const runningSessions = useRuntimeStore((s) => s.runningSessions);
  const sessions = useRuntimeStore((s) => s.sessions);
  const questions = useRuntimeStore((s) => s.questions);
  const permissions = useRuntimeStore((s) => s.permissions);
  const sessionParents = useRuntimeStore((s) => s.sessionParents);
  const finishedUnseen = useRuntimeStore((s) => s.finishedUnseen);
  const dropSessionState = useRuntimeStore((s) => s.dropSessionState);
  const navigate = useNavigate();

  const onActivate = useCallback(
    (tab: Tab) => {
      useUiStore.getState().activateTab(tab.id);
      // Session tabs drive the route so LiveSessionPage opens that conversation.
      if (tab.kind === 'session') {
        navigate(tab.sessionId ? `/live/${tab.sessionId}` : '/live');
      }
    },
    [navigate],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const current = useUiStore.getState().tabs;
      if (/^[1-9]$/.test(e.key)) {
        const target = current[Number(e.key) - 1];
        if (!target) return;
        e.preventDefault();
        onActivate(target);
        return;
      }
      if (e.ctrlKey && e.key === 'Tab' && current.length > 1) {
        e.preventDefault();
        const active = useUiStore.getState().activeTabId;
        const index = current.findIndex((t) => t.id === active);
        const step = e.shiftKey ? -1 : 1;
        onActivate(current[(index + step + current.length) % current.length]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onActivate]);

  if (tabs.length === 0) return null;

  // Session tab titles follow the live session title (renames update in
  // place); file tabs use the stored file name.
  const tabTitle = (t: Tab): string =>
    t.kind === 'session' && t.sessionId
      ? (sessions.find((s) => s.id === t.sessionId)?.title ?? t.title)
      : t.title;

  // Closing a tab never deletes the underlying session - it only drops the tab,
  // plus that conversation's in-memory thread/pane/scroll state (the session
  // keeps running and stays listed in the sidebar, reopenable any time).
  // If the closed tab was active and a neighbor session tab takes over, follow
  // it so the main area stays in sync with the highlighted tab. Closing into a
  // file tab (or no tab) leaves the main area as-is.
  const onClose = (e: React.MouseEvent, tab: Tab) => {
    e.stopPropagation();
    const wasActive = tab.id === useUiStore.getState().activeTabId;
    closeTab(tab.id);
    if (tab.kind === 'session' && tab.sessionId) dropSessionState(tab.sessionId);
    if (wasActive) {
      const after = useUiStore.getState();
      const next = after.tabs.find((t) => t.id === after.activeTabId);
      if (next?.kind === 'session') {
        navigate(next.sessionId ? `/live/${next.sessionId}` : '/live');
      }
    }
  };

  return (
    <div
      role="tablist"
      aria-label="会话标签"
      className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-surface px-2"
    >
      {tabs.map((t) => {
        const active = t.id === activeTabId;
        // The status dot answers "does this tab need me?": running, blocked on
        // an answer, or finished while I was elsewhere.
        const sessionId = t.kind === 'session' ? t.sessionId : null;
        const running = !!sessionId && !!runningSessions[sessionId];
        const needsAnswer =
          !!sessionId &&
          (questions.some((q) => rootSessionOf(sessionParents, q.sessionId) === sessionId) ||
            permissions.some((p) => rootSessionOf(sessionParents, p.sessionId) === sessionId));
        const finished = !!sessionId && !active && !needsAnswer && !!finishedUnseen[sessionId];
        const dotLabel = running
          ? '正在运行'
          : needsAnswer
            ? '等待你的回复'
            : finished
              ? '已完成一轮'
              : undefined;
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onActivate(t)}
            // Middle click closes, as tabs do everywhere else.
            onAuxClick={(e) => {
              if (e.button === 1) onClose(e, t);
            }}
            className={cn(
              'group flex max-w-[200px] cursor-pointer items-center gap-1.5 rounded-t-md px-2.5 py-1.5 text-[12px] transition-colors',
              active ? 'bg-bg text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
            )}
            title={tabTitle(t)}
          >
            {t.kind === 'file' ? (
              <FileText size={12} className="shrink-0" />
            ) : (
              <MessageSquare size={12} className="shrink-0" />
            )}
            <span
              title={dotLabel}
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                running
                  ? 'bg-accent animate-pulse'
                  : needsAnswer
                    ? 'bg-warn'
                    : finished
                      ? 'bg-ok'
                      : 'bg-transparent',
              )}
            />
            <span className="truncate">{tabTitle(t)}</span>
            <button
              onClick={(e) => onClose(e, t)}
              className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-surface-2 group-hover:opacity-100"
              aria-label={`关闭 ${tabTitle(t)}`}
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
