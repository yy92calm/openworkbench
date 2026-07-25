import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { ArrowDown, ArrowUp, ChevronDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/lib/store";

const isMac = navigator.userAgent.includes("Mac");
const isWindows = navigator.userAgent.includes("Windows");

const SHELLS = isWindows
  ? [
      { value: "powershell", label: "PowerShell" },
      { value: "pwsh7", label: "PowerShell 7" },
      { value: "cmd", label: "CMD" },
    ]
  : [
      { value: "bash", label: "Bash" },
      { value: "zsh", label: "Zsh" },
    ];

const FONT_KEY = "workbench.terminal.fontSize";
const FONT_MIN = 10;
const FONT_MAX = 24;
const FONT_DEFAULT = 13;
const SCROLLBACK = 10000;

function loadFontSize(): number {
  const n = Number(localStorage.getItem(FONT_KEY));
  return Number.isFinite(n) && n >= FONT_MIN && n <= FONT_MAX ? n : FONT_DEFAULT;
}

interface Tab {
  id: string;
  shell: string;
  connected: boolean;
}

// ── TerminalView: a single xterm instance with its own PTY ────────────────
interface TerminalViewProps {
  id: string;
  shell: string;
  fontSize: number;
  active: boolean;
  onFontSizeChange: (n: number) => void;
  onConnectedChange: (connected: boolean) => void;
}

function TerminalView({
  id,
  shell,
  fontSize,
  active,
  onFontSizeChange,
  onConnectedChange,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const theme = useUiStore((s) => s.theme);

  const getTerminalTheme = useCallback(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string) => cs.getPropertyValue(name).trim() || "#000";
    return {
      background: v("--surface"),
      foreground: v("--text"),
      cursor: v("--accent"),
      selectionBackground: v("--accent-soft") || "rgba(193,95,60,0.3)",
      black: v("--bg"),
      red: v("--error"),
      green: v("--ok"),
      yellow: v("--warn"),
      blue: v("--accent"),
      magenta: "#c08ae0",
      cyan: "#5fc8c8",
      white: v("--text-dim"),
      brightBlack: v("--border"),
      brightRed: v("--error"),
      brightGreen: v("--ok"),
      brightYellow: v("--warn"),
      brightBlue: v("--accent-strong"),
      brightMagenta: "#d4a8f0",
      brightCyan: "#7dd8d8",
      brightWhite: v("--text"),
    };
  }, []);

  // Apply theme when app theme changes.
  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = getTerminalTheme();
  }, [theme, getTerminalTheme]);

  // Apply font size; refit because glyph metrics change.
  useEffect(() => {
    const term = termRef.current;
    if (term) {
      term.options.fontSize = fontSize;
      fitRef.current?.fit();
    }
  }, [fontSize]);

  // Focus + refit when this view becomes the active tab (also recovers from
  // having been display:none, where xterm had zero size).
  useEffect(() => {
    if (active) {
      termRef.current?.focus();
      const raf = requestAnimationFrame(() => fitRef.current?.fit());
      return () => cancelAnimationFrame(raf);
    }
  }, [active]);

  // Create the terminal + PTY once per (id, shell).
  useEffect(() => {
    const term = new Terminal({
      fontSize,
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Cascadia Code', monospace",
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: SCROLLBACK,
      theme: getTerminalTheme(),
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(search);
    fitRef.current = fit;
    searchRef.current = search;

    if (containerRef.current) term.open(containerRef.current);
    termRef.current = term;

    // Copy / paste / find / font-size via xterm's key handler. Return false
    // to suppress the default terminal behavior for handled combos.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const copyPasteMod = isMac ? e.metaKey : e.ctrlKey && e.shiftKey;
      // Copy: selection only (no selection -> let Ctrl+C reach the shell).
      if (copyPasteMod && e.key.toLowerCase() === "c" && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection()).catch(() => {});
        return false;
      }
      // Paste.
      if (copyPasteMod && e.key.toLowerCase() === "v") {
        navigator.clipboard.readText().then((t) => term.paste(t)).catch(() => {});
        return false;
      }
      // Find.
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "f") {
        setShowSearch((s) => !s);
        return false;
      }
      // Font size.
      const fmod = isMac ? e.metaKey : e.ctrlKey;
      if (fmod && (e.key === "=" || e.key === "+")) {
        onFontSizeChange(Math.min(FONT_MAX, fontSizeRef.current + 1));
        return false;
      }
      if (fmod && e.key === "-") {
        onFontSizeChange(Math.max(FONT_MIN, fontSizeRef.current - 1));
        return false;
      }
      if (fmod && e.key === "0") {
        onFontSizeChange(FONT_DEFAULT);
        return false;
      }
      return true;
    });

    // Create PTY session in the main process.
    window.electronAPI.invoke("terminal:create", id, "local", shell).then(() => {
      onConnectedChange(true);
      term.focus();
    });

    const removeData = window.electronAPI.on(`terminal:data:${id}`, (data: unknown) =>
      term.write(data as string),
    );
    const removeExit = window.electronAPI.on(`terminal:exit:${id}`, (code: unknown) => {
      term.write(`\r\n\x1b[31m进程已退出 (code: ${code ?? "unknown"})\x1b[0m\r\n`);
      onConnectedChange(false);
    });
    const removeError = window.electronAPI.on(`terminal:error:${id}`, (msg: unknown) => {
      term.write(`\r\n\x1b[31m错误: ${msg}\x1b[0m\r\n`);
    });

    term.onData((data: string) => window.electronAPI.invoke("terminal:write", id, data));

    const doResize = () => {
      fit.fit();
      const dims = fit.proposeDimensions();
      if (dims) window.electronAPI.invoke("terminal:resize", id, dims.cols, dims.rows);
    };
    const onWinResize = () => doResize();
    window.addEventListener("resize", onWinResize);
    const ro = new ResizeObserver(doResize);
    if (containerRef.current) ro.observe(containerRef.current);
    setTimeout(doResize, 50);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onWinResize);
      window.electronAPI.invoke("terminal:close", id);
      removeData();
      removeExit();
      removeError();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, shell]);

  // Right-click: copy if there is a selection, otherwise paste.
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const term = termRef.current;
    if (!term) return;
    if (term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection()).catch(() => {});
    } else {
      navigator.clipboard.readText().then((t) => term.paste(t)).catch(() => {});
    }
  };

  const runSearch = (reverse: boolean, text: string) => {
    const s = searchRef.current;
    if (!s || !text) return;
    if (reverse) s.findPrevious(text);
    else s.findNext(text);
  };

  return (
    <div className="flex h-full flex-col bg-surface" onContextMenu={onContextMenu}>
      {showSearch && (
        <div className="flex items-center gap-1 border-b border-border px-2 py-1">
          <input
            value={query}
            autoFocus
            placeholder="查找..."
            onChange={(e) => {
              setQuery(e.target.value);
              runSearch(false, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch(e.shiftKey, query);
              } else if (e.key === "Escape") {
                setShowSearch(false);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-[11px] text-text outline-none"
          />
          <button
            onClick={() => runSearch(false, query)}
            className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-text"
            title="下一个"
          >
            <ArrowDown size={12} />
          </button>
          <button
            onClick={() => runSearch(true, query)}
            className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-text"
            title="上一个"
          >
            <ArrowUp size={12} />
          </button>
          <button
            onClick={() => setShowSearch(false)}
            className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-text"
            title="关闭搜索"
          >
            <X size={12} />
          </button>
        </div>
      )}
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  );
}

// ── TerminalPanel: tab container ──────────────────────────────────────────
interface TerminalPanelProps {
  onClose: () => void;
}

export function TerminalPanel({ onClose }: TerminalPanelProps) {
  const idRef = useRef(0);
  const [fontSize, setFontSize] = useState<number>(loadFontSize);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showShellMenu, setShowShellMenu] = useState(false);

  const addTab = useCallback((shell: string) => {
    const id = `term-${++idRef.current}`;
    setTabs((t) => [...t, { id, shell, connected: false }]);
    setActiveId(id);
    setShowShellMenu(false);
  }, []);

  // Open one default tab on first mount.
  useEffect(() => {
    if (idRef.current === 0) addTab(SHELLS[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((t) => {
        const idx = t.findIndex((x) => x.id === id);
        const next = t.filter((x) => x.id !== id);
        if (next.length === 0) {
          onClose();
          return [];
        }
        if (id === activeId) {
          const ni = Math.min(idx, next.length - 1);
          setActiveId(next[ni].id);
        }
        return next;
      });
    },
    [activeId, onClose],
  );

  const setConnected = useCallback((id: string, connected: boolean) => {
    setTabs((t) => t.map((x) => (x.id === id ? { ...x, connected } : x)));
  }, []);

  const onFontSizeChange = useCallback((n: number) => {
    setFontSize(n);
    try {
      localStorage.setItem(FONT_KEY, String(n));
    } catch {
      /* ignore quota errors */
    }
  }, []);

  const shellLabel = (v: string) => SHELLS.find((s) => s.value === v)?.label ?? v;

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 border-b border-border px-1 py-1">
        {tabs.map((t, i) => (
          <div
            key={t.id}
            onClick={() => setActiveId(t.id)}
            title={shellLabel(t.shell)}
            className={cn(
              "group flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors",
              t.id === activeId ? "bg-surface-2 text-text" : "text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", t.connected ? "bg-ok" : "bg-border")} />
            <span>终端 {i + 1}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
              className="rounded p-0.5 opacity-0 transition-opacity hover:bg-surface-2 group-hover:opacity-100"
              title="关闭标签"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        {/* New tab + shell selector */}
        <div className="relative ml-1">
          <button
            onClick={() => setShowShellMenu((s) => !s)}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-text"
            title="新建终端"
          >
            <Plus size={12} />
            <ChevronDown size={9} />
          </button>
          {showShellMenu && (
            <div className="absolute left-0 top-full z-dropdown mt-1 overflow-hidden rounded-card border border-border bg-surface shadow-pop">
              {SHELLS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => addTab(s.value)}
                  className="flex w-full items-center px-3 py-1.5 text-left text-[11px] text-text hover:bg-surface-2"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="flex-1" />
        <button
          onClick={onClose}
          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
          title="关闭终端面板"
        >
          <X size={13} />
        </button>
      </div>
      {/* Views: all stay mounted (hidden when inactive) so PTY + scrollback
          survive tab switches. */}
      <div className="relative min-h-0 flex-1">
        {tabs.map((t) => (
          <div key={t.id} className={cn("absolute inset-0", t.id === activeId ? "block" : "hidden")}>
            <TerminalView
              id={t.id}
              shell={t.shell}
              fontSize={fontSize}
              active={t.id === activeId}
              onFontSizeChange={onFontSizeChange}
              onConnectedChange={(c) => setConnected(t.id, c)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
