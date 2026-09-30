import { BrowserPanel } from '@fafawork/browser-mcp/panel';
import type { ArtifactBlock, ThreadBlock } from '@workbench/shared';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ContextPanel } from '@/components/inspector/ContextPanel';
import { FileBrowserPanel } from '@/components/inspector/FileBrowserPanel';
import { InspectorShell } from '@/components/inspector/InspectorShell';
import { TasksPanel } from '@/components/inspector/TasksPanel';
import { TerminalPanel } from '@/components/inspector/TerminalPanel';
import { fileInspectorFromBlock } from '@/lib/artifacts';
import type { ThreadTodo } from '@/lib/threadTasks';
import { useResizable } from '@/lib/useResizable';

/**
 * Right-side dock: context, tasks, browser, terminal, files, or artifact
 * preview. Tab bar is in the Topicbar; this component only renders the content.
 */
export function WorkbenchDock({
  artifact,
  browserUrl,
  tab,
  dockVisible,
  todos,
  blocks,
  onCloseArtifact,
  onBrowserUrlChange,
  onCloseBrowser,
  onCloseTerminal,
  onCloseFileBrowser,
  onOpenSession,
  onEvaluate,
}: {
  artifact: ArtifactBlock | null;
  browserUrl: string;
  tab: 'context' | 'tasks' | 'browser' | 'terminal' | 'files';
  dockVisible: boolean;
  /** The active session's captured todo list (see runtime's Thread.todos). */
  todos: readonly ThreadTodo[];
  /** The active session's blocks, for deriving its subagent tasks. */
  blocks: readonly ThreadBlock[];
  onCloseArtifact: () => void;
  onBrowserUrlChange: (url: string) => void;
  onCloseBrowser: () => void;
  onCloseTerminal: () => void;
  onCloseFileBrowser: () => void;
  onOpenSession: (sessionId: string, title: string) => void;
  onEvaluate?: (expr: string) => void;
}) {
  const { targetRef, handleProps, isDragging } = useResizable(480, 320, Infinity, true);
  const [paneKey, setPaneKey] = useState(0);
  const refreshPane = useCallback(() => setPaneKey((k) => k + 1), []);
  // Browser and terminal stay mounted once first opened so their state
  // survives tab switches, but neither is mounted up front - the conversation
  // starts free of the browser webview until the user (or an MCP open) needs it.
  const [browserEverOpened, setBrowserEverOpened] = useState(false);
  const [terminalEverOpened, setTerminalEverOpened] = useState(false);
  useEffect(() => {
    if (tab === 'browser') setBrowserEverOpened(true);
    if (tab === 'terminal') setTerminalEverOpened(true);
  }, [tab]);
  const showArtifact = !!artifact;

  return (
    <>
      <div
        {...handleProps}
        className={
          dockVisible
            ? 'w-1 shrink-0 cursor-col-resize hover:bg-accent/30 active:bg-accent/50 transition-colors'
            : 'hidden'
        }
      />
      <div
        ref={targetRef as React.RefObject<HTMLDivElement>}
        className={dockVisible ? 'hidden h-full shrink-0 overflow-hidden lg:block' : 'hidden'}
        style={{ width: 480, contentVisibility: isDragging ? 'hidden' : undefined }}
      >
        {showArtifact && (
          <div className="relative h-full">
            <button
              onClick={refreshPane}
              className="absolute right-2 top-2 z-sticky rounded-input border border-border bg-surface p-1.5 text-muted hover:bg-surface-2 hover:text-text"
              title="刷新预览"
            >
              <RefreshCw size={14} />
            </button>
            <InspectorShell
              key={paneKey}
              inspector={fileInspectorFromBlock(artifact!)}
              onClose={onCloseArtifact}
              onEvaluate={onEvaluate}
            />
          </div>
        )}
        {!showArtifact && (
          <>
            {/* Browser: mounted on first use (user switches to it or an MCP
                open does), then kept alive across tab switches. */}
            {browserEverOpened && (
              <div
                className={tab === 'browser' ? 'h-full' : 'hidden h-full'}
                aria-hidden={tab !== 'browser' ? 'true' : undefined}
                tabIndex={tab !== 'browser' ? -1 : undefined}
              >
                <BrowserPanel
                  url={browserUrl}
                  onUrlChange={onBrowserUrlChange}
                  onClose={onCloseBrowser}
                />
              </div>
            )}
            {/* Other panels: rendered only when active (terminal keeps alive) */}
            {tab === 'context' && <ContextPanel onClose={() => {}} />}
            {tab === 'tasks' && (
              <TasksPanel
                todos={todos}
                blocks={blocks}
                onOpenSession={onOpenSession}
                onClose={onCloseFileBrowser}
              />
            )}
            {terminalEverOpened && (
              <div
                className={tab === 'terminal' ? 'h-full' : 'hidden h-full'}
                aria-hidden={tab !== 'terminal' ? 'true' : undefined}
                tabIndex={tab !== 'terminal' ? -1 : undefined}
              >
                <TerminalPanel onClose={onCloseTerminal} />
              </div>
            )}
            {tab === 'files' && <FileBrowserPanel onClose={onCloseFileBrowser} />}
          </>
        )}
      </div>
    </>
  );
}
