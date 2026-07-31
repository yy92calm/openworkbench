import { useState, useMemo, useRef, useEffect } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { CalendarClock, FolderTree, PanelLeftClose, PanelLeft, Plus, Search, Settings, Trash2, X } from "lucide-react";
import type { Project } from "@workbench/shared";
import type { SessionMeta } from "@workbench/sdk";
import { cn } from "@/lib/cn";
import { isDesktop } from "@/lib/electron";
import { useRuntimeStore } from "@/lib/runtime";
import { useI18n } from "@/lib/i18n";
import { useUiStore } from "@/lib/store";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { baseName } from "@/components/thread/WorkspaceChip";
import logo from "@/assets/logo.webp";

interface Row {
  id: string;
  title: string;
  to: string;
  kind: "session" | "example";
}

/** Group session rows by their workspace directory. Examples stay ungrouped.
 *  Exported for unit testing. */
export function groupRowsByDirectory(
  rows: Row[],
  sessions: { id: string; directory?: string }[],
): { groups: [string, Row[]][]; exampleRows: Row[] } {
  const sessionRows = rows.filter((r) => r.kind === "session");
  const exampleRows = rows.filter((r) => r.kind === "example");
  const map = new Map<string, Row[]>();
  for (const r of sessionRows) {
    const dir = sessions.find((s) => s.id === r.id)?.directory ?? "";
    const key = dir || "默认";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return { groups: [...map.entries()], exampleRows };
}

/** Format a token count for compact display: 1234 → "1.2k", 12345 → "12k". */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function Sidebar({ project }: { project: Project }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { sessions, hiddenExamples, runningSessions, startDraft } = useRuntimeStore();
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const openSessionTab = useUiStore((s) => s.openSessionTab);

  const startNew = () => {
    startDraft();
    openSessionTab(null, "新会话");
    navigate("/live");
  };

  const rows: Row[] = [
    ...sessions
      .filter((s) => !s.parentId)
      .map((s) => ({ id: s.id, title: s.title, to: `/live/${s.id}`, kind: "session" as const })),
    ...project.sessions
      .filter((e) => !hiddenExamples.includes(e.id))
      .map((e) => ({ id: e.id, title: e.title, to: `/example/${e.id}`, kind: "example" as const })),
  ];

  // Session search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter((r) => r.title.toLowerCase().includes(q));
  }, [rows, searchQuery]);

  // Group session rows by their workspace directory; examples stay ungrouped.
  const groups = useMemo(
    () => groupRowsByDirectory(filteredRows, sessions),
    [filteredRows, sessions],
  );

  const overlayTitlebar = isDesktop && navigator.userAgent.includes("Mac");

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-r border-border bg-surface">
      {overlayTitlebar && <div className="h-10 shrink-0 drag-region" />}
      <div className={cn("px-3 pb-2", overlayTitlebar ? "pt-1" : "pt-3")}>
        <div className="flex items-center gap-2">
          <img src={logo} alt="" className="h-[20px] w-auto" />
          <span className="text-[14px] font-semibold tracking-tight text-text">Workbench</span>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5 px-2">
        <NavRow icon={<Plus size={15} />} label={t("sidebar.new")} onClick={startNew} />
        <NavRow icon={<CalendarClock size={15} />} label={t("sidebar.tasks")} onClick={() => navigate("/tasks")} />
        <NavRow icon={<FolderTree size={15} />} label={t("sidebar.skills")} onClick={() => navigate("/skills")} />
      </nav>

      <div className="mt-3 flex-1 overflow-y-auto px-2 pb-2">
        <div className="mb-1.5 border-b border-border-soft/60 pb-1">
          <div className="flex items-center gap-1 px-2">
            <span className="flex-1 text-xs font-medium uppercase tracking-wider text-muted">{t("sidebar.history")}</span>
            <button
              onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setSearchQuery(""); }}
              className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-text"
              aria-label="搜索会话"
            >
              {searchOpen ? <X size={13} /> : <Search size={13} />}
            </button>
          </div>
          {searchOpen && (
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="筛选会话…"
              className="mt-1 w-full rounded-input border border-border-soft bg-bg px-2 py-1 text-sm text-text outline-none placeholder:text-muted focus:border-accent/40"
            />
          )}
        </div>
        {filteredRows.length === 0 && (
          <div className="px-2 py-2 text-sm text-muted">
            {searchQuery ? "无匹配" : t("sidebar.noConversations")}
          </div>
        )}
        {groups.groups.map(([dir, groupRows]) => (
          <div key={dir}>
            <div className="mt-2 mb-0.5 flex items-center gap-1 px-2.5 first:mt-0">
              <FolderTree size={11} className="shrink-0 text-muted" />
              <span className="truncate text-[11px] font-medium text-muted" title={dir !== "默认" ? dir : undefined}>
                {dir === "默认" ? "默认" : baseName(dir)}
              </span>
              <span className="ml-auto text-[10px] text-muted/50">{groupRows.length}</span>
            </div>
            {groupRows.map((row) => (
              <SessionRow key={row.to} row={row} isRunning={!!runningSessions[row.id]} meta={sessions.find((s) => s.id === row.id)} />
            ))}
          </div>
        ))}
        {groups.exampleRows.map((row) => (
          <SessionRow key={row.to} row={row} isRunning={false} />
        ))}
      </div>

      <div className="border-t border-border-soft/60 px-2 py-2">
        <div className="flex items-center gap-1">
          <button
            className="flex items-center gap-1.5 rounded-input px-2 py-0.5 text-sm text-muted hover:bg-surface-2 hover:text-text"
            onClick={() => navigate("/settings")}
            aria-label="设置"
          >
            <Settings size={16} />
            <span>{t("sidebar.settings")}</span>
          </button>
          <span className="flex-1" />
          <button
            onClick={toggleSidebar}
            className="rounded-input p-1.5 text-muted hover:bg-surface-2 hover:text-text"
            aria-label={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            title={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
          >
            {sidebarCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
      </div>
    </aside>
  );
}

function NavRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-input px-2.5 py-1.5 text-[13px] text-text-dim transition-colors hover:bg-surface-2 hover:text-text"
    >
      <span className="text-muted">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function SessionRow({ row, isRunning, meta }: { row: Row; isRunning: boolean; meta?: SessionMeta }) {
  const location = useLocation();
  const openSessionTab = useUiStore((s) => s.openSessionTab);
  const { t } = useI18n();
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);

  // Token/cost summary line
  const totalTokens = (meta?.promptTokens ?? 0) + (meta?.completionTokens ?? 0);
  const detail = row.kind === "session" && totalTokens > 0
    ? `${formatTokens(totalTokens)} tok${meta?.cost ? ` · $${meta.cost.toFixed(4)}` : ""}`
    : null;

  return (
    <div className="group relative">
      <NavLink
        to={row.to}
        onClick={() => {
          if (row.kind === "session") openSessionTab(row.id, row.title);
        }}
        className={cn(
          "relative flex flex-col gap-0 rounded-input py-1 pl-2.5 pr-7 transition-colors duration-150 hover:bg-surface-2",
          location.pathname === row.to ? "bg-surface-2 text-text" : "text-text/90",
        )}
      >
        {location.pathname === row.to && (
          <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />
        )}
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              row.kind === "example" ? "bg-muted"
                : isRunning ? "bg-accent animate-pulse"
                : "bg-ok",
            )}
          />
          <span className="flex-1 truncate text-sm">{row.title}</span>
          {row.kind === "example" && (
            <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[11px] uppercase tracking-wide text-muted ring-1 ring-border">
              {t("sidebar.example")}
            </span>
          )}
        </span>
        {detail && (
          <span className="pl-3 text-[10px] leading-tight text-muted/70">{detail}</span>
        )}
      </NavLink>
      <button
        onClick={() => setPendingDelete(row)}
        aria-label={`删除 ${row.title}`}
        className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded p-1 text-muted hover:bg-border hover:text-error group-hover:block"
      >
        <Trash2 size={13} />
      </button>
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.kind === "session" ? t("sidebar.deleteSession") : t("sidebar.hideExample")}
          body={
            pendingDelete.kind === "session"
              ? `"${pendingDelete.title}"${t("sidebar.deleteSessionBody")}`
              : `"${pendingDelete.title}"${t("sidebar.hideExampleBody")}`
          }
          confirmLabel={pendingDelete.kind === "session" ? t("sidebar.delete") : t("sidebar.hide")}
          onConfirm={() => {
            setPendingDelete(null);
            // Delegate to parent's delete logic via store
            if (pendingDelete.kind === "session") {
              useRuntimeStore.getState().deleteSession(pendingDelete.id);
            } else {
              useRuntimeStore.getState().hideExample(pendingDelete.id);
            }
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}