import { useEffect, useMemo, useRef } from "react";
import { Outlet } from "react-router-dom";
import { PanelLeft } from "lucide-react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { StatusBar } from "@/components/sidebar/StatusBar";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { Toaster } from "@/components/ui/Toaster";
import { mockProject } from "@/lib/mock";
import { useRuntimeStore } from "@/lib/runtime";
import { useUiStore } from "@/lib/store";
import { openExternal } from "@/lib/electron";
import { cn } from "@/lib/cn";

export function AppShell() {
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const resizingRef = useRef(false);

  useEffect(() => {
    void useRuntimeStore.getState().bootstrap();
  }, []);

  // External links open in the system browser.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest?.("a[href]");
      const href = anchor?.getAttribute("href") ?? "";
      if (/^https?:\/\//i.test(href)) {
        e.preventDefault();
        void openExternal(href);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Sidebar resize: pointer-based drag with DOM-only updates during drag.
  const onResizerPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarCollapsed ? 200 : sidebarWidth;
    resizingRef.current = true;

    const onMove = (ev: PointerEvent) => {
      const next = Math.max(160, Math.min(360, startW + ev.clientX - startX));
      document.documentElement.style.setProperty("--sidebar-width", `${next}px`);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      resizingRef.current = false;
      // Read the live width from the DOM and commit.
      const live = parseFloat(document.documentElement.style.getPropertyValue("--sidebar-width")) || 200;
      document.documentElement.style.removeProperty("--sidebar-width");
      setSidebarWidth(live);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // Inline --sidebar-width must respect the collapsed state, otherwise it
  // overrides the CSS class's 0px and the sidebar keeps occupying space (the
  // expand trigger then sits over a transparent but non-zero column).
  const layoutStyle = useMemo(
    () => ({ "--sidebar-width": sidebarCollapsed ? "0px" : `${sidebarWidth}px` }) as React.CSSProperties,
    [sidebarWidth, sidebarCollapsed],
  );

return (
    <>
      <div
        className={cn(
          "layout-container bg-bg text-text",
          sidebarCollapsed && "layout--sidebar-collapsed",
        )}
        style={layoutStyle}
      >
        <aside className={cn("sidebar-panel", sidebarCollapsed && "sidebar-panel--collapsed")}>
          <Sidebar project={mockProject} />
        </aside>
        {/* Expand trigger when sidebar is collapsed */}
        {sidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            className="absolute left-0 top-1/2 z-sticky -translate-y-1/2 rounded-r-md border border-border bg-surface px-1 py-4 text-muted opacity-60 shadow-card hover:opacity-100 focus:opacity-100 transition-opacity"
aria-label="展开侧边栏"
          title="展开侧边栏"
          >
            <PanelLeft size={14} />
          </button>
        )}
        <div
          className="sidebar-resizer"
          onPointerDown={onResizerPointerDown}
        />
        <main className="chat-pane">
          <Outlet />
        </main>
        <div className="layout-status-bar">
          <StatusBar />
        </div>
      </div>
      <CommandPalette />
      <Toaster />
    </>
  );
}