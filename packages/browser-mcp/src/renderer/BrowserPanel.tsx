import { useState, useRef, useCallback, useEffect } from "react";
import { ArrowLeft, ArrowRight, Globe, RefreshCw, Terminal, X, Circle, Square, Save, Play, ChevronRight } from "lucide-react";

/**
 * Browser panel using Electron's <webview> for full browser automation.
 * The agent can execute JavaScript, navigate, read page content, interact with
 * elements, and take screenshots via the MCP server.
 */

interface WebviewElement extends HTMLElement {
  src: string;
  loadURL: (url: string) => void;
  getURL: () => string;
  getTitle: () => string;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  executeJavaScript: (code: string) => Promise<unknown>;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  capturePage: () => Promise<{ toDataURL: () => string }>;
  getWebContentsId: () => number;
  addEventListener: (event: string, handler: (...args: unknown[]) => void) => void;
  removeEventListener: (event: string, handler: (...args: unknown[]) => void) => void;
}

export function BrowserPanel({
  url,
  onUrlChange,
  onClose,
}: {
  url: string;
  onUrlChange: (url: string) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState(url);
  const [history, setHistory] = useState<string[]>([url || "https://www.google.com"]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showJsConsole, setShowJsConsole] = useState(false);
  const [jsInput, setJsInput] = useState("");
  const [jsResult, setJsResult] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordCount, setRecordCount] = useState(0);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showReplayList, setShowReplayList] = useState(false);
  const [replayList, setReplayList] = useState<{ name: string; steps: number; created: string }[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);
  const webviewRef = useRef<WebviewElement | null>(null);

  // Sync recording state with main process on mount
  useEffect(() => {
    window.electronAPI.browserRecordState().then((state: unknown) => {
      const s = state as { isRecording: boolean; count: number };
      setIsRecording(s.isRecording);
      setRecordCount(s.count);
    });
  }, []);

  const toggleRecordStart = async () => {
    await window.electronAPI.browserRecordStart();
    setIsRecording(true);
    setRecordCount(0);
  };

  const toggleRecordStop = async () => {
    const result = await window.electronAPI.browserRecordStop() as { count: number };
    setIsRecording(false);
    setRecordCount(result.count);
    setJsResult(`录制结束，共 ${result.count} 步`);
    setShowJsConsole(true);
  };

  const handleSave = async () => {
    if (!saveName.trim()) return;
    const result = await window.electronAPI.browserRecordSave(saveName.trim()) as { ok: boolean; count: number; error?: string };
    if (result.ok) {
      setJsResult(`已保存录制 "${saveName.trim()}"（${result.count} 步）`);
    } else {
      setJsResult(`保存失败: ${result.error}`);
    }
    setShowJsConsole(true);
    setShowSaveInput(false);
    setSaveName("");
  };

  const handleShowReplayList = async () => {
    const list = await window.electronAPI.browserRecordList() as { name: string; steps: number; created: string }[];
    setReplayList(list);
    setShowReplayList(!showReplayList);
  };

  const handleReplay = async (name: string) => {
    setShowReplayList(false);
    setIsReplaying(true);
    setJsResult(`正在回放 "${name}"…`);
    setShowJsConsole(true);
    const result = await window.electronAPI.browserRecordReplay(name) as { ok: boolean; count: number; results: string[]; error?: string };
    setIsReplaying(false);
    if (result.ok) {
      setJsResult(`回放完成（${result.count} 步）:\n${result.results.join("\n")}`);
    } else {
      setJsResult(`回放失败: ${result.error}`);
    }
  };

  const currentUrl = history[historyIndex] || "about:blank";

  // Sync external URL changes
  useEffect(() => {
    if (url && url !== currentUrl && url !== webviewRef.current?.getURL()) {
      setInput(url);
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(url);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      webviewRef.current?.loadURL(url);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Listen for webview navigation events
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const onNavigate = (e: { url: string }) => {
      if (e.url && e.url !== currentUrl) {
        setInput(e.url);
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(e.url);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
        onUrlChange(e.url);
      }
    };
    wv.addEventListener("did-navigate", onNavigate);
    wv.addEventListener("did-navigate-in-page", onNavigate);

    // Prevent links from opening in external browser — redirect into the webview
    const onDidAttach = () => {
      try {
        const wcId = wv.getWebContentsId();
        void window.electronAPI.invoke("browser:setup-webview", wcId);
      } catch { /* webview not ready yet */ }
    };
    wv.addEventListener("did-attach", onDidAttach);
    // Also try immediately in case did-attach already fired
    onDidAttach();

    return () => {
      wv.removeEventListener("did-navigate", onNavigate);
      wv.removeEventListener("did-navigate-in-page", onNavigate);
      wv.removeEventListener("did-attach", onDidAttach);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, historyIndex, onUrlChange]);

  const navigate = useCallback((target: string) => {
    let href = target.trim();
    if (!href) return;
    if (!/^https?:\/\//i.test(href)) {
      href = `https://${href}`;
    }
    setInput(href);
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(href);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    onUrlChange(href);
    webviewRef.current?.loadURL(href);
  }, [history, historyIndex, onUrlChange]);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const historyRef = useRef(history);
  historyRef.current = history;
  const historyIndexRef = useRef(historyIndex);
  historyIndexRef.current = historyIndex;
  const onUrlChangeRef = useRef(onUrlChange);
  onUrlChangeRef.current = onUrlChange;

  // Listen for commands from the MCP server (via main process IPC)
  useEffect(() => {
    const handler = async (_event: unknown, msg: { requestId?: string; cmd: string; url?: string; code?: string; selector?: string; text?: string; value?: string; x?: number; y?: number }) => {
      const wv = webviewRef.current;
      const sendResponse = (result: unknown) => {
        if (msg.requestId) {
          window.electronAPI.browserCommandResponse(msg.requestId, result);
        }
      };

      try {
        switch (msg.cmd) {
          case "navigate":
            if (msg.url) navigateRef.current(msg.url);
            sendResponse({ ok: true });
            break;

          case "back":
            wv?.goBack();
            sendResponse({ ok: true });
            break;

          case "forward":
            wv?.goForward();
            sendResponse({ ok: true });
            break;

          case "refresh":
            wv?.reload();
            sendResponse({ ok: true });
            break;

          case "execute-js":
            if (msg.code && wv) {
              const result = await wv.executeJavaScript(msg.code);
              sendResponse(result);
            } else {
              sendResponse({ error: "No code or webview not ready" });
            }
            break;

          case "get-content":
            if (wv) {
              const text = await wv.executeJavaScript("document.body?.innerText ?? ''");
              const title = await wv.executeJavaScript("document.title ?? ''");
              const content = title ? `标题: ${title}\n\n${text}` : (text as string);
              sendResponse(content);
            } else {
              sendResponse("Webview 还未准备好");
            }
            break;

          case "get-html":
            if (wv) {
              const html = await wv.executeJavaScript("document.documentElement?.outerHTML ?? ''");
              sendResponse(html);
            } else {
              sendResponse("Webview 还未准备好");
            }
            break;

          case "get-url":
            sendResponse(wv?.getURL() ?? "");
            break;

          case "get-title":
            sendResponse(wv?.getTitle() ?? "");
            break;

          case "click":
            if (msg.selector && wv) {
              const result = await wv.executeJavaScript(`
                (() => {
                  const el = document.querySelector(${JSON.stringify(msg.selector)});
                  if (!el) return { error: "Element not found: ${msg.selector}" };
                  if (el instanceof HTMLElement) el.click();
                  else return { error: "Element is not clickable" };
                  return { ok: true };
                })()
              `);
              sendResponse(result);
            } else {
              sendResponse({ error: "No selector or webview not ready" });
            }
            break;

          case "click-at":
            if (msg.x !== undefined && msg.y !== undefined && wv) {
              const result = await wv.executeJavaScript(`
                (() => {
                  const el = document.elementFromPoint(${msg.x}, ${msg.y});
                  if (el) {
                    if (el instanceof HTMLElement) el.click();
                    return { ok: true, tag: el.tagName };
                  }
                  return { error: "No element at (${msg.x}, ${msg.y})" };
                })()
              `);
              sendResponse(result);
            } else {
              sendResponse({ error: "Missing coordinates or webview not ready" });
            }
            break;

          case "type-selector":
            if (msg.selector && msg.text !== undefined && wv) {
              const result = await wv.executeJavaScript(`
                (() => {
                  const el = document.querySelector(${JSON.stringify(msg.selector)});
                  if (!el) return { error: "Element not found" };
                  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                    el.value = ${JSON.stringify(msg.text)};
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return { ok: true };
                  }
                  return { error: "Element is not an input or textarea" };
                })()
              `);
              sendResponse(result);
            } else {
              sendResponse({ error: "Missing selector/text or webview not ready" });
            }
            break;

          case "select":
            if (msg.selector && msg.value !== undefined && wv) {
              const result = await wv.executeJavaScript(`
                (() => {
                  const el = document.querySelector(${JSON.stringify(msg.selector)});
                  if (!el) return { error: "Element not found" };
                  if (el instanceof HTMLSelectElement) {
                    el.value = ${JSON.stringify(msg.value)};
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return { ok: true };
                  }
                  return { error: "Element is not a select" };
                })()
              `);
              sendResponse(result);
            } else {
              sendResponse({ error: "Missing selector/value or webview not ready" });
            }
            break;

          case "hover":
            if (msg.selector && wv) {
              const result = await wv.executeJavaScript(`
                (() => {
                  const el = document.querySelector(${JSON.stringify(msg.selector)});
                  if (!el) return { error: "Element not found" };
                  if (el instanceof HTMLElement) {
                    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                    return { ok: true };
                  }
                  return { error: "Element is not an HTMLElement" };
                })()
              `);
              sendResponse(result);
            } else {
              sendResponse({ error: "No selector or webview not ready" });
            }
            break;

          case "scroll":
            if (wv) {
              await wv.executeJavaScript(`
                window.scrollBy({
                  top: ${msg.y ?? 0},
                  left: ${msg.x ?? 0},
                  behavior: 'smooth'
                });
              `);
              sendResponse({ ok: true });
            } else {
              sendResponse({ error: "Webview not ready" });
            }
            break;

          case "screenshot":
            if (wv) {
              const page = await wv.capturePage();
              const dataUrl = page.toDataURL();
              sendResponse(dataUrl);
            } else {
              sendResponse({ error: "Webview not ready" });
            }
            break;

          default:
            sendResponse({ error: `Unknown command: ${msg.cmd}` });
        }
      } catch (err) {
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
      }
    };
    return window.electronAPI.on("browser:command", handler);
  }, []);

  const goBack = () => {
    if (historyIndex > 0) {
      webviewRef.current?.goBack();
      const idx = historyIndex - 1;
      setHistoryIndex(idx);
      setInput(history[idx]);
      onUrlChange(history[idx]);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      webviewRef.current?.goForward();
      const idx = historyIndex + 1;
      setHistoryIndex(idx);
      setInput(history[idx]);
      onUrlChange(history[idx]);
    }
  };

  const refresh = () => {
    webviewRef.current?.reload();
  };

  const runJs = async () => {
    if (!jsInput.trim() || !webviewRef.current) return;
    try {
      const result = await webviewRef.current.executeJavaScript(jsInput.trim());
      setJsResult(JSON.stringify(result, null, 2));
    } catch (err) {
      setJsResult(`错误: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      {/* URL bar */}
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <button onClick={goBack} disabled={!canGoBack} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30" title="后退">
          <ArrowLeft size={13} />
        </button>
        <button onClick={goForward} disabled={!canGoForward} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30" title="前进">
          <ArrowRight size={13} />
        </button>
        <button onClick={refresh} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text" title="刷新">
          <RefreshCw size={13} />
        </button>
        <div className="relative flex-1">
          <Globe size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); navigate(input); } }}
            placeholder="输入网址…"
            className="w-full rounded-input border border-border bg-bg py-1 pl-7 pr-2 text-[11px] text-text outline-none placeholder:text-muted focus:border-accent/40"
          />
        </div>
        {/* 录制控制：录制/停止切换 */}
        {isRecording ? (
          <button
            onClick={toggleRecordStop}
            className="flex items-center gap-1 rounded-input bg-error px-2 py-1 text-[11px] font-medium text-white animate-pulse hover:opacity-90"
            title="停止录制"
          >
            <Square size={12} className="fill-current" /> 停止{recordCount > 0 ? ` ${recordCount}` : ""}
          </button>
        ) : (
          <button
            onClick={toggleRecordStart}
            className="flex items-center gap-1 rounded-input border border-error/40 px-2 py-1 text-[11px] font-medium text-error hover:bg-error/10"
            title="开始录制"
          >
            <Circle size={12} className="fill-current" /> 录制
          </button>
        )}
        <button
          onClick={() => { setShowSaveInput(!showSaveInput); setShowReplayList(false); }}
          disabled={isRecording || recordCount === 0}
          className="flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent"
          title="保存录制"
        >
          <Save size={12} /> 保存
        </button>
        <div className="relative">
          <button
            onClick={handleShowReplayList}
            disabled={isReplaying}
            className={
              isReplaying
                ? "flex items-center gap-1 rounded-input border border-accent/40 px-2 py-1 text-[11px] text-accent"
                : showReplayList
                  ? "flex items-center gap-1 rounded-input border border-accent/40 px-2 py-1 text-[11px] text-accent"
                  : "flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2 disabled:opacity-30"
            }
            title="回放录制"
          >
            {isReplaying ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />} 回放
          </button>
          {showReplayList && !isReplaying && (
            <div className="absolute right-0 top-full z-dropdown mt-1 w-52 rounded-card border border-border bg-surface shadow-pop">
              {replayList.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-muted">暂无保存的录制</div>
              ) : (
                replayList.map((r) => (
                  <button
                    key={r.name}
                    onClick={() => handleReplay(r.name)}
                    className="flex w-full items-center gap-2 border-b border-border-soft px-3 py-1.5 text-left text-[11px] text-text last:border-0 hover:bg-surface-2"
                  >
                    <ChevronRight size={11} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="shrink-0 text-muted">{r.steps}步</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => { setShowJsConsole(!showJsConsole); setShowSaveInput(false); setShowReplayList(false); }}
          className={showJsConsole ? "rounded-input bg-accent/10 p-1 text-accent" : "rounded-input p-1 text-muted hover:bg-surface-2 hover:text-text"}
          title="JavaScript 控制台"
        >
          <Terminal size={13} />
        </button>
        <button onClick={onClose} className="rounded-input p-1 text-muted hover:bg-surface-2 hover:text-text" title="关闭浏览器">
          <X size={13} />
        </button>
      </div>

      {/* Save recording input */}
      {showSaveInput && (
        <div className="border-b border-border px-2 py-1.5">
          <div className="flex gap-1">
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
              placeholder="输入录制名称…"
              autoFocus
              className="flex-1 rounded-input border border-border bg-bg px-2 py-1 text-[11px] text-text outline-none placeholder:text-muted focus:border-accent/40"
            />
            <button onClick={handleSave} className="rounded-input bg-accent px-2 py-1 text-[11px] text-accent-fg hover:opacity-90">
              保存
            </button>
          </div>
        </div>
      )}

      {/* JS Console */}
      {showJsConsole && (
        <div className="border-b border-border px-2 py-1.5">
          <div className="flex gap-1">
            <input
              value={jsInput}
              onChange={(e) => setJsInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runJs(); } }}
              placeholder="输入 JavaScript 代码…"
              className="flex-1 rounded-input border border-border bg-bg px-2 py-1 font-mono text-[11px] text-text outline-none placeholder:text-muted focus:border-accent/40"
            />
            <button onClick={runJs} className="rounded-input bg-accent px-2 py-1 text-[11px] text-accent-fg hover:opacity-90">
              执行
            </button>
          </div>
          {jsResult && (
            <pre className="mt-1 max-h-24 overflow-y-auto rounded bg-bg-soft px-2 py-1 font-mono text-[11px] text-text">
              {jsResult}
            </pre>
          )}
        </div>
      )}

      {/* Webview */}
      <div className="min-h-0 flex-1">
        <webview
          ref={webviewRef as React.RefObject<HTMLElement>}
          src={currentUrl}
          style={{ height: "100%", width: "100%" }}
          allowpopups="true"
        />
      </div>
    </div>
  );
}