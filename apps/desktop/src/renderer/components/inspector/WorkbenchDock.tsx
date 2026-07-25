import { useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import type { ArtifactBlock } from "@workbench/shared";
import { fileInspectorFromBlock } from "@/lib/artifacts";
import { InspectorShell } from "@/components/inspector/InspectorShell";
import { ContextPanel } from "@/components/inspector/ContextPanel";
import { BrowserPanel } from "@fafawork/browser-mcp/panel";
import { TerminalPanel } from "@/components/inspector/TerminalPanel";
import { FileBrowserPanel } from "@/components/inspector/FileBrowserPanel";
import { useResizable } from "@/lib/useResizable";

/**
 * Right-side dock: context, browser, terminal, files, or artifact preview.
 * Tab bar is in the Topicbar; this component only renders the content.
 */
export function WorkbenchDock({
  artifact,
  browserUrl,
  tab,
  dockVisible,
  onCloseArtifact,
  onBrowserUrlChange,
  onCloseBrowser,
  onCloseTerminal,
  onCloseFileBrowser,
  onEvaluate,
}: {
  artifact: ArtifactBlock | null;
  browserUrl: string;
  tab: "context" | "browser" | "terminal" | "files";
  dockVisible: boolean;
  onCloseArtifact: () => void;
  onBrowserUrlChange: (url: string) => void;
  onCloseBrowser: () => void;
  onCloseTerminal: () => void;
  onCloseFileBrowser: () => void;
  onEvaluate?: (expr: string) => void;
}) {
  const { targetRef, handleProps, isDragging } = useResizable(480, 320, Infinity, true);
  const [paneKey, setPaneKey] = useState(0);
  const refreshPane = useCallback(() => setPaneKey((k) => k + 1), []);
  const showArtifact = !!artifact;

  return (
    <>
      <div
        {...handleProps}
        className={dockVisible ? "w-1 shrink-0 cursor-col-resize hover:bg-accent/30 active:bg-accent/50 transition-colors" : "hidden"}
      />
      <div
        ref={targetRef as React.RefObject<HTMLDivElement>}
        className={dockVisible ? "hidden h-full shrink-0 overflow-hidden lg:block" : "hidden"}
        style={{ width: 480, contentVisibility: isDragging ? "hidden" : undefined }}
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
            {/* Browser: always mounted for MCP command responsiveness */}
            <div className={tab === "browser" ? "h-full" : "hidden h-full"}>
              <BrowserPanel
                url={browserUrl}
                onUrlChange={onBrowserUrlChange}
                onClose={onCloseBrowser}
              />
            </div>
            {/* Other panels: rendered only when active */}
            {tab === "context" && <ContextPanel onClose={() => {}} />}
            {tab === "terminal" && <TerminalPanel id="main" onClose={onCloseTerminal} />}
            {tab === "files" && <FileBrowserPanel onClose={onCloseFileBrowser} />}
          </>
        )}
      </div>
    </>
  );
}