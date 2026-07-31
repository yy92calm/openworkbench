import { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FolderOpen, Loader2, NotebookPen, PlugZap, ArrowDown } from "lucide-react";
import type { ArtifactBlock, FileRoot } from "@workbench/shared";
import { DRAFT_KEY, rootSessionOf, subagentActivity, useRuntimeStore } from "@/lib/runtime";
import { pickFolder } from "@/lib/electron";
import { useScrollMemory } from "@/lib/scrollMemory";
import { useWorkspaceFiles } from "@/lib/useWorkspaceFiles";
import { fileInspectorFromBlock } from "@/lib/artifacts";
import { BlockList, type BlockHandlers } from "@/components/thread/BlockList";
import { JumpBar } from "@/components/thread/JumpBar";
import { DecisionSurface } from "@/components/thread/DecisionSurface";
import { TabBar } from "@/components/thread/TabBar";
import { Topicbar } from "@/components/thread/Topicbar";
import { baseName } from "@/components/thread/WorkspaceChip";
import { WorkflowStarters } from "@/components/thread/WorkflowStarters";
import { InspectorShell } from "@/components/inspector/InspectorShell";
import { WorkbenchDock } from "@/components/inspector/WorkbenchDock";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/lib/store";

/** Live agent session. `/live` (no id) is a blank draft;
 *  the session is created lazily on the first message, then the URL updates to /live/:id. */
export function LiveSessionPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const {
    status,
    switching,
    sending,
    runningSessions,
    serverUrl,
    sessions,
    currentId,
    threads,
    error,
    questions,
    permissions,
    sessionParents,
    workspace,
    switchWorkspace,
    panes,
    commands,
    connect,
    openSession,
    startDraft,
    sendPrompt,
    runShell,
    runCommand,
    closeArtifact,
    setBrowserUrl,
    answerQuestion,
    rejectQuestion,
    replyPermission,
    interrupt,
    reconcileRunning,
    permissionMode,
    setPermissionMode,
  } = useRuntimeStore();

  // A deliberate workspace move restarts the sidecar — expected and brief, so
  // the UI stays "connected" (no badge flip, no Connect button, no help card).
  // Only a real failure (retry window exhausted, switching cleared) surfaces.
  const connected = status === "ready" || switching;
  const connecting = status === "connecting" && !switching;
  const displayStatus = switching ? "ready" : status;

  useEffect(() => {
    if (sessionId) void openSession(sessionId);
    else startDraft(); // blank draft - no session created yet (#3)
  }, [sessionId, openSession, startDraft]);

  // NOTE: the tab bar is NOT auto-synced to the route. Historical sessions do
  // not get a tab by default - a tab opens only when the user picks a session
  // in the sidebar (Sidebar) or starts a new one. The draft tab is converted
  // to the real session tab in afterTurn below (its first message creates it).

  // All three composer paths reflect a freshly-created session in the URL.
  const afterTurn = (id: string | null) => {
    if (id && !sessionId) {
      navigate(`/live/${id}`);
      // Convert the draft tab into the real session tab (the session was just
      // created by the first message). Not an auto-open - the tab already
      // exists from startNew; only its sessionId updates.
      openSessionTab(id);
    }
  };
  const onSend = async (text: string) => {
    // Browser commands: browser:go <url>, browser:content [url], browser:js <code>
    const browserMatch = text.match(/^browser:(go|content|js)\s*(.*)?$/i);
    if (browserMatch) {
      const cmd = browserMatch[1].toLowerCase();
      const arg = browserMatch[2]?.trim();
      if (cmd === "go" && arg) {
        const url = /^https?:\/\//i.test(arg) ? arg : `https://${arg}`;
        setBrowserUrl(url);
        return;
      }
      if (cmd === "content") {
        const targetUrl = arg || browserUrl;
        if (targetUrl) {
          const content = await window.electronAPI.browserFetch(targetUrl);
          const msg = content ? `已获取页面内容:\n\n${content}` : `无法获取页面内容: ${targetUrl}`;
          await sendPrompt(msg);
          return;
        }
      }
      if (cmd === "js" && arg) {
        // Execute JS in the browser panel — the result is returned via the webview
        const msg = `已发送脚本到浏览器执行，请查看浏览器控制台输出。`;
        await sendPrompt(msg);
        return;
      }
      return;
    }
    afterTurn(await sendPrompt(text));
  };
  const onRunShell = async (command: string) => afterTurn(await runShell(command));
  const onRunCommand = async (name: string, args: string) => afterTurn(await runCommand(name, args));

  // Interactions from the thread/inspector fold back into the conversation as follow-up prompts.
  const setComposerDraft = useUiStore((s) => s.setComposerDraft);
  const openFileTab = useUiStore((s) => s.openFileTab);
  const closeTab = useUiStore((s) => s.closeTab);
  const openSessionTab = useUiStore((s) => s.openSessionTab);
  // The active main-area tab. A file tab replaces the conversation in the main
  // area (the right dock stays); a session tab drives the conversation below.
  const activeTab = useUiStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const handlers: BlockHandlers = {
    onArtifactOpen: openFileTab,
    onFigureComment: (a, title) =>
      void sendPrompt(`On the figure ${title}, at (${a.x.toFixed(0)}%, ${a.y.toFixed(0)}%): ${a.note}`),
    // Subagent events fold into their own thread; a running task row reads
    // its child's latest step from there.
    subagentActivity: (childId) => subagentActivity(threads[childId]?.blocks),
    onUserMessageEdit: (text) => setComposerDraft(text),
  };
  const onEvaluate = (expr: string) => void sendPrompt(`Evaluate in the notebook kernel:\n\`\`\`python\n${expr}\n\`\`\``);

  // A draft shows its local thread (the first message echoes there instantly,
  // before any session exists) — it is grafted onto the session id on create.
  const thread = currentId ? threads[currentId] : threads[DRAFT_KEY];
  // Opening a session fetches its history (cross-folder opens also restart the
  // sidecar) — show skeleton shapes meanwhile, never a blank page.
  const historyLoading = connected && !!sessionId && !thread?.loaded;
  const title = sessions.find((s) => s.id === currentId)?.title;
  const isEmpty = !thread || thread.blocks.length === 0;
  // @ mention candidates: workspace files first (what the user can actually
  // reference), then artifact-derived paths the agent produced — merged, unique.
  const { files: workspaceFiles } = useWorkspaceFiles();
  const fileSuggestions = useMemo(() => {
    const ordered: string[] = [...workspaceFiles];
    if (thread) {
      for (const b of thread.blocks) {
        if (b.kind === "artifact") {
          const name = b.path.split(/[\\/]/).pop() ?? b.path;
          ordered.push(name);
        }
      }
    }
    return Array.from(new Set(ordered));
  }, [thread, workspaceFiles]);
  // The turn lifecycle: `sending` covers click → POST accepted (incl. the
  // dated-folder setup on a first message); `running` covers the agent
  // working until session.idle. Together they lock the composer and show the
  // working indicator, so a sent message is never silently "nowhere".
  const running = !!(currentId && runningSessions[currentId]);
  const working = sending || running;
  // What the agent is doing right now — the newest still-running tool call.
  const currentTool = working
    ? [...(thread?.blocks ?? [])]
        .reverse()
        .find((b): b is Extract<typeof b, { kind: "tool-call" }> =>
          b.kind === "tool-call" && b.status === "running",
        )
    : undefined;

  // Esc interrupts the running turn (like a terminal agent). Modals own Esc
  // while open; the composer's palette marks its Esc as handled.
  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      void interrupt();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, interrupt]);

  // Backstop while "Working…": if session.idle got lost (SSE reconnect
  // windows), a slow poll re-checks the server so the spinner can never
  // outlive the turn.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => void reconcileRunning(), 15_000);
    return () => window.clearInterval(t);
  }, [running, reconcileRunning]);

  // The oldest unanswered request blocks the run — surface it. Requests from
  // subagents carry their CHILD session id; resolve through the parent chain
  // so they still land in the conversation the user is looking at.
  const belongsHere = (sid: string) =>
    !!currentId && (sid === currentId || rootSessionOf(sessionParents, sid) === currentId);
  const activeQuestion = questions.find((q) => belongsHere(q.sessionId));
  const activePermission = permissions.find((p) => belongsHere(p.sessionId));
  const activeRequest = activeQuestion ?? activePermission;
  // Name the subagent on the card when the ask isn't from the main agent.
  const requestOrigin =
    activeRequest && activeRequest.sessionId !== currentId
      ? (sessions.find((s) => s.id === activeRequest.sessionId)?.title ?? "a subagent")
      : undefined;

  // Notebooks the agent touched in THIS session — the conversation ↔ notebook map.
  const sessionNotebooks = (thread?.blocks ?? []).filter(
    (b): b is Extract<typeof b, { kind: "artifact" }> =>
      b.kind === "artifact" && b.filename.endsWith(".ipynb"),
  );
  const uniqueNotebooks = [...new Map(sessionNotebooks.map((b) => [b.path, b])).values()];

  // The right pane belongs to the session: each one remembers its own open
  // artifact or Files browser (mutually exclusive, enforced by the store) and
  // gets it back when the user returns.
  const pane = panes[currentId ?? DRAFT_KEY];
  const activeArtifact = pane?.artifact ?? null;
  const browserUrl = pane?.browserUrl ?? "";
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<"context" | "browser" | "terminal" | "files">("context");

  // Conversation scroll position, per session — restored once history is in.
  const chatRef = useRef<HTMLDivElement>(null);
  const onChatScroll = useScrollMemory(chatRef, `chat:${currentId ?? DRAFT_KEY}`, !historyLoading);
  // Scroll-to-bottom FAB: visible when the user has scrolled up.
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const scrollToBottom = () => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  };
  // Track whether the user is near the bottom for auto-scroll.
  const nearBottomRef = useRef(true);

  // Keep nearBottomRef in sync with the scroll position.
  const onChatScrollWithBtn = (e: React.UIEvent<HTMLDivElement>) => {
    onChatScroll(e);
    const el = e.currentTarget;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = distFromBottom < 100;
    setShowScrollBtn(distFromBottom > 200);
  };

  // When a decision surface (question/permission) appears, auto-scroll to
  // the bottom so the user sees it without having to scroll manually.
  useEffect(() => {
    if (!activeRequest) return;
    scrollToBottom();
  }, [activeRequest]);

  // Auto-scroll when new blocks arrive and the user is near the bottom.
  const blockCount = thread?.blocks.length ?? 0;
  useEffect(() => {
    if (!nearBottomRef.current) return;
    scrollToBottom();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockCount]);

  // Listen for browser:panel IPC to open/close the right panel
  useEffect(() => {
    return window.electronAPI.on("browser:panel", (_event: unknown, msg: { action: string; url?: string }) => {
      if (msg.action === "open") {
        setRightPanelOpen(true);
        setRightPanelTab("browser");
        if (msg.url) setBrowserUrl(msg.url);
      } else if (msg.action === "close") {
        setRightPanelOpen(false);
      }
    });
  }, [setBrowserUrl]);

  // When the agent starts working a notebook (Jupyter MCP), open it beside the
  const autoOpened = useRef(new Set<string>());
  useEffect(() => {
    const agentNb = uniqueNotebooks.find(
      (b) => b.tool.toLowerCase().includes("jupyter") && !autoOpened.current.has(b.path),
    );
    if (agentNb) {
      autoOpened.current.add(agentNb.path);
      // Open the notebook as a background tab - it must not steal the
      // conversation view while the agent is still working.
      openFileTab(agentNb, undefined, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueNotebooks.length]);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <TabBar />
      <div className="flex h-full min-w-0">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {activeTab?.kind === "file" ? (
          <FilePreviewTab artifact={activeTab.artifact} root={activeTab.root} onClose={() => closeTab(activeTab.id)} onEvaluate={onEvaluate} />
        ) : (
        <>
        <Topicbar
          title={title}
          rightPanelOpen={rightPanelOpen || !!activeArtifact}
          currentTab={rightPanelTab}
          onTabChange={(tab) => {
            setRightPanelOpen(true);
            setRightPanelTab(tab);
          }}
          onClosePanel={() => {
            if (activeArtifact) closeArtifact();
            else setRightPanelOpen(false);
          }}
        />
        <div ref={chatRef} onScroll={onChatScrollWithBtn} className="relative flex-1 overflow-y-auto">
          {/* Minimal floating toolbar at top-right for Files/Notebook */}
          <div className="sticky top-2 z-sticky flex justify-end px-4">
            <div className="flex items-center gap-1.5 rounded-full border border-border-soft/60 bg-surface/80 px-2 py-1 shadow-card backdrop-blur-sm">
              {uniqueNotebooks.map((nb) => (
                <button
                  key={nb.path}
                  onClick={() => openFileTab(nb)}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] transition-colors",
                    activeArtifact?.path === nb.path ? "bg-surface-2 text-text" : "text-muted hover:bg-surface-2 hover:text-text",
                  )}
                  title={`Open ${nb.path}`}
                >
                  <NotebookPen size={10} />
                  <span className="max-w-[120px] truncate">{nb.filename}</span>
                </button>
              ))}
              <button
                onClick={() => { setRightPanelOpen(true); setRightPanelTab("files"); }}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors",
                  rightPanelOpen && rightPanelTab === "files" ? "bg-surface-2 text-text" : "text-muted hover:bg-surface-2 hover:text-text",
                )}
                title={`浏览此会话的文件夹${workspace ? ` — ${workspace}` : ""}`}
                aria-pressed={rightPanelOpen && rightPanelTab === "files"}
              >
                <FolderOpen size={10} />
                <span className="max-w-[100px] truncate">
                  {sessionId && workspace ? baseName(workspace) : "文件"}
                </span>
              </button>
              {!connected && (
                <button
                  onClick={connect}
                  disabled={connecting}
                  className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
                >
                  {connecting ? <Loader2 size={10} className="animate-spin" /> : <PlugZap size={10} />}
连接
                </button>
              )}
            </div>
          </div>
          <div className="mx-auto flex max-w-[880px] flex-col px-6 py-6">
            {/* JumpBar — floating navigation for long conversations */}
            {thread && <JumpBar blocks={thread.blocks} />}
            {/* Deliberate workspace switches don't render anything at all (they're
                masked as connected); a genuine boot/reconnect shows only the
                header badge's pulsing dot — anything appearing and disappearing
                in the content flow makes the page jump. The help card is for
                real error/offline states. */}
            {!connected && !connecting && (
              <div className="rounded-card border border-border bg-surface p-5 shadow-card">
                <div className="text-sm font-medium text-text">Agent 运行时</div>
                <p className="mt-1 text-sm text-muted">
                  桌面应用会自动运行内置的 Agent 运行时。在浏览器中，请先运行{" "}
                  <span className="font-mono">agent serve</span> 然后连接。
                </p>
                <div className="mt-3 rounded-input bg-surface-2 px-3 py-2 font-mono text-xs text-text">
                  {serverUrl}
                </div>
              </div>
            )}
            {error && (
              <div className="rounded-input border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                {error}
              </div>
            )}
            {connected && isEmpty && !sessionId && (
              <WorkflowStarters onPick={(p) => void onSend(p)} />
            )}
            {historyLoading && <ThreadSkeleton />}
            {!historyLoading && thread && <BlockList blocks={thread.blocks} handlers={handlers} />}
            {working && (
              // Typing indicator: three bouncing dots + current tool name
              <div className="flex min-w-0 items-center gap-2.5 text-sm text-muted">
                <span className="flex shrink-0 items-center gap-1">
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
                </span>
                <span className="shrink-0 text-[13px]">
                  {activeRequest
                    ? "已暂停 — 请在下方回答 Agent 的问题"
                    : sending && !currentId
                      ? "正在启动会话…"
                      : "工作中"}
                </span>
                {!activeRequest && currentTool && (
                  <span className="truncate rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text-dim" title={currentTool.title}>
                    {currentTool.title}
                  </span>
                )}
              </div>
            )}
          </div>
          {/* Scroll-to-bottom FAB */}
          {showScrollBtn && (
            <button
              onClick={scrollToBottom}
              className="sticky bottom-4 left-full mr-6 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface shadow-pop transition-opacity hover:bg-surface-2"
              title="滚动到底部"
            >
              <ArrowDown size={15} className="text-muted" />
            </button>
          )}
        </div>

        <div className="relative px-6 pb-4 pt-2">
          {/* Gradient fade from chat to composer area */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-bg to-transparent" />
          <div className="mx-auto max-w-[880px] space-y-3">
            {/* Folder picker — shows current workspace, click to switch (draft only) */}
            <FolderPickerRow workspace={workspace} pinned={!!currentId} onSwitch={async () => {
              const dir = await pickFolder();
              if (dir) void switchWorkspace({ path: dir });
            }} />
            <DecisionSurface
              question={activeQuestion}
              permission={activeQuestion ? undefined : activePermission}
              origin={requestOrigin}
              permissionMode={permissionMode}
              onAnswer={(id, answers) => void answerQuestion(id, answers)}
              onReject={(id) => void rejectQuestion(id)}
              onPermission={(id, reply) => void replyPermission(id, reply)}
              onPermissionModeChange={(m) => void setPermissionMode(m)}
              composer={{
                onSend,
                onRunShell: (c) => void onRunShell(c),
                onRunCommand: (n, a) => void onRunCommand(n, a),
                commands,
                fileSuggestions,
                disabled: !connected || working,
                working: running,
                onStop: () => void interrupt(),
                placeholder: working ? "等待回复…" : connected ? "有什么想问的？" : "连接后开始聊天",
              }}
            />
          </div>
        </div>
        </>
        )}
      </div>

      <WorkbenchDock
        artifact={activeArtifact}
        browserUrl={browserUrl}
        tab={rightPanelTab}
        dockVisible={rightPanelOpen || !!activeArtifact}
        onCloseArtifact={closeArtifact}
        onBrowserUrlChange={setBrowserUrl}
        onCloseBrowser={() => setRightPanelOpen(false)}
        onCloseTerminal={() => setRightPanelOpen(false)}
        onCloseFileBrowser={() => setRightPanelOpen(false)}
        onEvaluate={onEvaluate}
      />
      </div>
    </div>
  );
}

/** A file preview shown as a main-area tab (replaces the conversation while
 *  active). Wraps the same InspectorShell the dock used, full-width. */
function FilePreviewTab({
  artifact,
  root,
  onClose,
  onEvaluate,
}: {
  artifact: ArtifactBlock;
  root?: FileRoot;
  onClose: () => void;
  onEvaluate?: (expr: string) => void;
}) {
  return (
    <div className="h-full">
      <InspectorShell inspector={{ ...fileInspectorFromBlock(artifact), root }} onClose={onClose} onEvaluate={onEvaluate} />
    </div>
  );
}

/** Loading placeholder mirroring the thread's real shapes: a user card, agent
 *  text lines, a quiet tool row — so the page never sits blank while history
 *  loads and nothing jumps when the content arrives. */
function ThreadSkeleton() {
  return (
    <div className="animate-pulse space-y-5" aria-hidden>
      {/* User bubble skeleton — right-aligned */}
      <div className="flex justify-end">
        <div className="h-11 w-[60%] rounded-[14px] bg-surface-2" />
      </div>
      {/* Agent text skeleton — left-aligned, full width */}
      <div className="space-y-2.5 px-1 pt-1">
        <div className="h-3.5 w-11/12 rounded bg-surface-2" />
        <div className="h-3.5 w-4/5 rounded bg-surface-2" />
        <div className="h-3.5 w-2/3 rounded bg-surface-2" />
      </div>
      {/* Tool call skeleton */}
      <div className="h-9 rounded-lg border border-border-soft bg-surface/60" />
      {/* Another user bubble */}
      <div className="flex justify-end">
        <div className="h-11 w-[45%] rounded-[14px] bg-surface-2" />
      </div>
      <div className="space-y-2.5 px-1 pt-1">
        <div className="h-3.5 w-5/6 rounded bg-surface-2" />
        <div className="h-3.5 w-3/5 rounded bg-surface-2" />
      </div>
    </div>
  );
}

/** Lightweight folder picker row above the composer. Shows the current
 *  workspace; clickable to switch when the session is still a draft. */
function FolderPickerRow({ workspace, pinned, onSwitch }: { workspace: string | null; pinned: boolean; onSwitch: () => void }) {
  return (
    <button
      onClick={pinned ? undefined : onSwitch}
      disabled={pinned}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-input px-2 py-1 text-left text-[12px] text-muted transition-colors",
        pinned ? "cursor-default opacity-70" : "hover:bg-surface-2 hover:text-text",
      )}
      title={workspace ?? undefined}
    >
      <FolderOpen size={12} className="shrink-0" />
      <span className="truncate">{workspace ? baseName(workspace) : "选择工作文件夹"}</span>
      {!pinned && <span className="ml-auto shrink-0 text-[11px] text-muted/60">点击切换</span>}
    </button>
  );
}
