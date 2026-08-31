import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { ChevronDown, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

// Inline cn utility for self-containment
const cn = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(' ');

interface TerminalPanelProps {
  id: string;
  onClose: () => void;
}

const isWindows = navigator.userAgent.includes('Windows');

const SHELLS = isWindows
  ? [
      { value: 'powershell', label: 'PowerShell' },
      { value: 'pwsh7', label: 'PowerShell 7' },
      { value: 'cmd', label: 'CMD' },
    ]
  : [
      { value: 'bash', label: 'Bash' },
      { value: 'zsh', label: 'Zsh' },
    ];

/**
 * Terminal panel for the right sidebar. Supports local shell (bash/zsh/cmd/powershell).
 * Uses xterm.js for terminal emulation and communicates with the main process via IPC.
 */
export function TerminalPanel({ id, onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [shell, setShell] = useState(SHELLS[0].value);
  const [showShellMenu, setShowShellMenu] = useState(false);
  const [connected, setConnected] = useState(false);

  // Read CSS variables for terminal theme
  const getTerminalTheme = useCallback(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string) => cs.getPropertyValue(name).trim() || '#000';
    return {
      background: v('--surface'),
      foreground: v('--text'),
      cursor: v('--accent'),
      selectionBackground: v('--accent-soft') || 'rgba(193,95,60,0.3)',
      black: v('--bg'),
      red: v('--error'),
      green: v('--ok'),
      yellow: v('--warn'),
      blue: v('--accent'),
      magenta: '#c08ae0',
      cyan: '#5fc8c8',
      white: v('--text-dim'),
      brightBlack: v('--border'),
      brightRed: v('--error'),
      brightGreen: v('--ok'),
      brightYellow: v('--warn'),
      brightBlue: v('--accent-strong'),
      brightMagenta: '#d4a8f0',
      brightCyan: '#7dd8d8',
      brightWhite: v('--text'),
    };
  }, []);

  // Update terminal theme when app theme changes (via data-theme attribute)
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    const applyTheme = () => {
      term.options.theme = getTerminalTheme();
    };
    applyTheme();
    // Watch for data-theme changes on <html>
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, [getTerminalTheme]);

  const writeToTerminal = useCallback((data: string) => {
    const term = terminalRef.current;
    if (!term) return;
    term.write(data);
  }, []);

  useEffect(() => {
    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Cascadia Code', monospace",
      cursorBlink: true,
      cursorStyle: 'block',
      theme: getTerminalTheme(),
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    fitAddonRef.current = fitAddon;

    if (containerRef.current) {
      term.open(containerRef.current);
    }

    terminalRef.current = term;

    // Create terminal session in main process
    window.electronAPI.invoke('terminal:create', id, 'local', shell).then(() => {
      setConnected(true);
      term.focus();
    });

    // Listen for terminal data from main process
    const removeData = window.electronAPI.on(`terminal:data:${id}`, (data: unknown) =>
      writeToTerminal(data as string),
    );
    const removeExit = window.electronAPI.on(`terminal:exit:${id}`, (code: unknown) => {
      term.write(`\r\n\x1b[31m进程已退出 (code: ${code ?? 'unknown'})\x1b[0m\r\n`);
      setConnected(false);
    });
    const removeError = window.electronAPI.on(`terminal:error:${id}`, (msg: unknown) => {
      term.write(`\r\n\x1b[31m错误: ${msg}\x1b[0m\r\n`);
    });

    // Handle user input
    const onData = (data: string) => {
      window.electronAPI.invoke('terminal:write', id, data);
    };
    term.onData(onData);

    const onResize = () => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        window.electronAPI.invoke('terminal:resize', id, dims.cols, dims.rows);
      }
    };
    window.addEventListener('resize', onResize);

    // Observe container size changes (sidebar drag, tab switch)
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        window.electronAPI.invoke('terminal:resize', id, dims.cols, dims.rows);
      }
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    setTimeout(onResize, 50);

    return () => {
      resizeObserver.disconnect();
      window.electronAPI.invoke('terminal:close', id);
      removeData();
      removeExit();
      removeError();
      window.removeEventListener('resize', onResize);
      term.dispose();
    };
  }, [id, shell, writeToTerminal, getTerminalTheme]);

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {/* Shell selector */}
        <div className="relative">
          <button
            onClick={() => setShowShellMenu(!showShellMenu)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-text"
          >
            {SHELLS.find((s) => s.value === shell)?.label ?? shell}
            <ChevronDown size={10} />
          </button>
          {showShellMenu && (
            <div className="absolute left-0 top-full z-dropdown mt-1 overflow-hidden rounded-card border border-border bg-surface shadow-pop">
              {SHELLS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => {
                    setShell(s.value);
                    setShowShellMenu(false);
                  }}
                  className={cn(
                    'flex w-full items-center px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-surface-2',
                    shell === s.value ? 'text-accent' : 'text-text',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="text-[11px] text-muted">终端</span>
        <span className="flex-1" />
        {connected && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
        <button
          onClick={onClose}
          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
          title="关闭终端"
        >
          <X size={13} />
        </button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  );
}
