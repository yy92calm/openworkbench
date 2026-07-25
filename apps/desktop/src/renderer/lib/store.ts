import { create } from "zustand";
import type { ArtifactBlock, FileRoot } from "@workbench/shared";
import { loadLocale, persistLocale, type Locale } from "./i18n";

export type Theme = "light" | "dark";
export type AgentRuntimeKind = "opencode" | "claude-code";

/** A main-area tab. Session tabs switch the active conversation (single
 *  instance - the agent keeps running in the background via the global event
 *  stream); file tabs show an artifact preview in the main area. */
export type Tab =
  | { id: string; kind: "session"; sessionId: string | null; title: string }
  | { id: string; kind: "file"; artifact: ArtifactBlock; title: string; root?: FileRoot };

const THEME_KEY = "workbench.theme";
const RUNTIME_KIND_KEY = "workbench.agentRuntimeKind";
const SIDEBAR_KEY = "workbench.sidebarWidth";
const SIDEBAR_COLLAPSED_KEY = "workbench.sidebarCollapsed";
const EXPAND_DETAILS_KEY = "workbench.expandThreadDetails";

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function initialSidebarWidth(): number {
  if (typeof window === "undefined") return 200;
  const saved = window.localStorage.getItem(SIDEBAR_KEY);
  const n = saved ? Number(saved) : NaN;
  return Number.isFinite(n) ? Math.max(160, Math.min(360, n)) : 200;
}

function initialSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
}

function initialRuntimeKind(): AgentRuntimeKind {
  if (typeof window === "undefined") return "opencode";
  const saved = window.localStorage.getItem(RUNTIME_KIND_KEY);
  return saved === "claude-code" ? "claude-code" : "opencode";
}

function initialExpandDetails(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(EXPAND_DETAILS_KEY) === "true";
}

interface UiState {
  theme: Theme;
  locale: Locale;
  /** Which agent runtime the app connects to (opencode / claude-code). */
  agentRuntimeKind: AgentRuntimeKind;
  inspectorOpen: boolean;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  paletteOpen: boolean;
  /** One-shot text placed into the composer by another surface (e.g. the
   *  provenance Reproduce action) - consumed on the next composer render. */
  composerDraft: string | null;
  /** Main-area tabs (session + file previews). In-memory: a restart clears
   *  them, matching the per-session pane memory. */
  tabs: Tab[];
  activeTabId: string | null;
  /** Default expand state for reasoning + tool-call cards when they mount.
   *  False (default) = collapsed; each card can still be toggled individually. */
  expandThreadDetails: boolean;
  setTheme: (theme: Theme) => void;
  setLocale: (locale: Locale) => void;
  toggleTheme: () => void;
  setAgentRuntimeKind: (kind: AgentRuntimeKind) => void;
  setInspectorOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
  setPaletteOpen: (open: boolean) => void;
  setComposerDraft: (draft: string | null) => void;
  setExpandThreadDetails: (expand: boolean) => void;
  /** Open/activate a session tab. A draft tab (sessionId null) converts into
   *  the real session when its first message creates one. */
  openSessionTab: (sessionId: string | null, title?: string) => void;
  /** Open/activate a file preview tab (deduped by artifact path). `activate`
   *  defaults to true; pass false to open it in the background (e.g. an
   *  auto-opened notebook that should not steal the conversation view). */
  openFileTab: (artifact: ArtifactBlock, root?: FileRoot, activate?: boolean) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: initialTheme(),
  locale: loadLocale(),
  agentRuntimeKind: initialRuntimeKind(),
  inspectorOpen: true,
  sidebarWidth: initialSidebarWidth(),
  sidebarCollapsed: initialSidebarCollapsed(),
  paletteOpen: false,
  expandThreadDetails: initialExpandDetails(),
  setTheme: (theme) => {
    if (typeof window !== "undefined") window.localStorage.setItem(THEME_KEY, theme);
    set({ theme });
  },
  setLocale: (locale) => {
    persistLocale(locale);
    set({ locale });
  },
  toggleTheme: () => get().setTheme(get().theme === "light" ? "dark" : "light"),
  setAgentRuntimeKind: (agentRuntimeKind) => {
    if (typeof window !== "undefined") window.localStorage.setItem(RUNTIME_KIND_KEY, agentRuntimeKind);
    set({ agentRuntimeKind });
  },
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setSidebarWidth: (sidebarWidth) => {
    const clamped = Math.max(160, Math.min(360, sidebarWidth));
    if (typeof window !== "undefined") window.localStorage.setItem(SIDEBAR_KEY, String(clamped));
    set({ sidebarWidth: clamped });
  },
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    if (typeof window !== "undefined") window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
    set({ sidebarCollapsed: next });
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  composerDraft: null,
  setComposerDraft: (composerDraft) => set({ composerDraft }),
  setExpandThreadDetails: (expandThreadDetails) => {
    if (typeof window !== "undefined") window.localStorage.setItem(EXPAND_DETAILS_KEY, String(expandThreadDetails));
    set({ expandThreadDetails });
  },
  tabs: [],
  activeTabId: null,
  openSessionTab: (sessionId, title) => set((s) => {
    const existing = s.tabs.find((t) => t.kind === "session" && t.sessionId === sessionId);
    if (existing) {
      const tabs = title ? s.tabs.map((t) => (t.id === existing.id ? { ...t, title } : t)) : s.tabs;
      return { tabs, activeTabId: existing.id };
    }
    // A draft tab (null) converts into the real session on first message.
    if (sessionId !== null) {
      const draft = s.tabs.find((t) => t.kind === "session" && t.sessionId === null);
      if (draft) {
        return {
          tabs: s.tabs.map((t) => (t.id === draft.id ? { ...t, sessionId, title: title ?? t.title } : t)),
          activeTabId: draft.id,
        };
      }
    }
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tab: Tab = { id, kind: "session", sessionId, title: title ?? "新会话" };
    return { tabs: [...s.tabs, tab], activeTabId: id };
  }),
  openFileTab: (artifact, root, activate = true) => set((s) => {
    const existing = s.tabs.find((t) => t.kind === "file" && t.artifact.path === artifact.path);
    if (existing) return activate ? { activeTabId: existing.id } : {};
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const title = artifact.filename || artifact.path.split(/[\\/]/).pop() || "预览";
    const tab: Tab = { id, kind: "file", artifact, title, root };
    return { tabs: [...s.tabs, tab], ...(activate ? { activeTabId: id } : {}) };
  }),
  closeTab: (id) => set((s) => {
    const idx = s.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return s;
    const tabs = s.tabs.filter((t) => t.id !== id);
    let activeTabId = s.activeTabId;
    if (activeTabId === id) {
      activeTabId = tabs.length ? tabs[Math.min(idx, tabs.length - 1)].id : null;
    }
    return { tabs, activeTabId };
  }),
  activateTab: (id) => set({ activeTabId: id }),
}));
