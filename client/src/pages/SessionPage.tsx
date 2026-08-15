import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Send, Wrench, Square, Paperclip, Download, X } from "lucide-react";
import type { OpenCodeEvent, HistoryMessage, AttachmentFile } from "@workbench/sdk";
import { getClient, onReconnect } from "@/lib/connection";

interface ToolRow {
  callID: string;
  tool: string;
  title?: string;
  status: string;
}

interface FileRow {
  /** Original file name. */
  name: string;
  /** Base64 body when the part carried inline content (local attachment
   *  echo / content the server resolved). */
  data?: string;
  mime?: string;
}

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
  tools: ToolRow[];
  files: FileRow[];
  active: boolean;
}

function toMsg(m: HistoryMessage, idx: number): Msg {
  const text = m.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("\n");
  const reasoning = m.parts
    .filter((p) => p.type === "reasoning")
    .map((p) => p.text ?? "")
    .join("\n");
  const tools: ToolRow[] = m.parts
    .filter((p): p is typeof m.parts[number] & { tool: string } => !!p.tool)
    .map((p) => ({
      callID: `${idx}-${p.tool}`,
      tool: p.tool,
      title: p.state?.title,
      status: p.state?.status ?? "completed",
    }));
  const files: FileRow[] = m.parts
    .filter((p): p is typeof m.parts[number] & { filename?: string } => p.type === "file")
    .map((p) => {
      const source = (p as { source?: { type?: string; text?: string; path?: string } }).source;
      return {
        name: (p as { filename?: string }).filename ?? source?.path ?? "附件",
        data: source?.type === "file" ? source.text : undefined,
        mime: (p as { mime?: string }).mime,
      };
    });
  return { id: `h${idx}`, role: m.role, text, reasoning: reasoning || undefined, tools, files, active: false };
}

/** Decode a base64 string to raw bytes (browser or node fallback). */
function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
}

function downloadFile(f: FileRow) {
  if (!f.data) return;
  const bytes = b64ToBytes(f.data);
  const blob = new Blob([bytes], { type: f.mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name || "attachment";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function SessionPage({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [hostOnline, setHostOnline] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeId = useRef<string | null>(null);
  const mounted = useRef(true);

  /** Scroll to bottom, but only when the user is already near the bottom —
   *  never yank them away from reading history above. */
  const scroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Load history + subscribe to live events for this session. Re-subscribes
  // after an automatic reconnect (the client instance is replaced).
  useEffect(() => {
    const client = getClient();
    if (!client) return;
    let unsub = () => {};
    const unsubReconnect = onReconnect(() => {
      // Client was rebuilt by the reconnector — reload history and re-subscribe.
      const c2 = getClient();
      if (!c2 || !mounted.current) return;
      unsub();
      unsub = c2.onEvent(handleEvent);
      void c2.getMessages(sessionId).then((h) => mounted.current && setMessages(h.map(toMsg))).catch(() => {});
    });
    const unsubStatus = client.onStatus((s) => {
      if (mounted.current) setHostOnline(s === "ready");
    });
    const handleEvent = (e: OpenCodeEvent) => {
      if (e.sessionId !== sessionId) return;
      setMessages((prev) => {
        const next = [...prev];
        let active = next.find((m) => m.active);
        // A running turn we didn't start (entered mid-stream, or the event
        // arrived before the optimistic message) — create the placeholder.
        if (!active && (e.type === "text.updated" || e.type === "reasoning.updated" || e.type === "tool.updated")) {
          active = { id: `a${Date.now()}`, role: "assistant", text: "", tools: [], files: [], active: true };
          next.push(active);
        }
        if (!active) return next;
        switch (e.type) {
          case "text.updated":
            active.text = e.text;
            break;
          case "reasoning.updated":
            active.reasoning = e.text;
            break;
          case "tool.updated": {
            const row = active.tools.find((t) => t.callID === e.callId);
            if (row) {
              row.status = e.status;
              if (e.title) row.title = e.title;
            } else {
              active.tools.push({ callID: e.callId, tool: e.tool, title: e.title, status: e.status });
            }
            break;
          }
          case "session.idle":
            active.active = false;
            activeId.current = null;
            setSending(false);
            break;
        }
        return next;
      });
      scroll();
    };
    void (async () => {
      try {
        const history = await client.getMessages(sessionId);
        if (!mounted.current) return;
        setMessages(history.map(toMsg));
        // If this session is mid-turn (busy/retry), open an active placeholder
        // so live text/tool events have somewhere to render.
        try {
          const status = await client.getSessionStatus();
          const st = status[sessionId];
          if (st && (st.type === "busy" || st.type === "retry")) {
            setMessages((prev) => [...prev, { id: `a${Date.now()}`, role: "assistant", text: "", tools: [], files: [], active: true }]);
          }
        } catch {
          /* status poll is best-effort */
        }
      } catch {
        /* history may be unavailable for brand-new sessions */
      }
      unsub = client.onEvent(handleEvent);
    })();
    return () => {
      mounted.current = false;
      unsub();
      unsubReconnect();
      unsubStatus();
    };
  }, [sessionId]);

  const send = async () => {
    const text = input.trim();
    const files = attachments;
    if ((!text && files.length === 0) || sending) return;
    const client = getClient();
    if (!client) return;
    setInput("");
    setAttachments([]);
    setSending(true);
    const id = `a${Date.now()}`;
    activeId.current = id;
    setMessages((prev) => [
      ...prev,
      {
        id: `u${Date.now()}`,
        role: "user",
        text,
        tools: [],
        files: files.map((f) => ({ name: f.filename, mime: f.mime })),
        active: false,
      },
      { id, role: "assistant", text: "", tools: [], files: [], active: true },
    ]);
    scroll();
    try {
      await client.sendPromptWithFiles(sessionId, text, files);
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: m.text || "（发送失败）", active: false } : m)));
      setSending(false);
    }
  };

  /** Pick local files from the file input into pending attachments. */
  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    Promise.all(
      picked.map((file) =>
        file.arrayBuffer().then((buf): AttachmentFile => ({ filename: file.name, mime: file.type || undefined, data: new Uint8Array(buf) })),
      ),
    ).then(setAttachments);
    e.target.value = "";
  };

  const abort = async () => {
    const client = getClient();
    if (!client) return;
    try {
      await client.abortSession(sessionId);
    } catch { /* ignore */ }
    setSending(false);
    setMessages((prev) => prev.map((m) => (m.active ? { ...m, active: false } : m)));
  };

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <button onClick={onBack} aria-label="返回" style={{ padding: 6, color: "var(--muted)" }}>
          <ArrowLeft size={18} />
        </button>
        <h1 style={{ fontSize: 15, fontWeight: 600, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          会话
        </h1>
        {sending && (
          <button onClick={() => void abort()} style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--error)", fontSize: 13, padding: 6 }}>
            <Square size={13} /> 停止
          </button>
        )}
      </header>

      {!hostOnline && (
        <div style={{ margin: "0 14px", padding: "7px 12px", borderRadius: 9, background: "color-mix(in srgb, var(--warn) 12%, transparent)", border: "1px solid var(--warn)", color: "var(--warn)", fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--warn)", animation: "pulse 1.2s infinite", flexShrink: 0 }} />
          主机离线，正在自动重连…
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
        {messages.length === 0 && (
          <p style={{ color: "var(--muted)", textAlign: "center", paddingTop: 60, fontSize: 14 }}>
            开始对话，agent 会在桌面端工作区执行任务
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div
              style={{
                maxWidth: "88%",
                padding: "10px 12px",
                borderRadius: 12,
                background: m.role === "user" ? "var(--accent-soft)" : "var(--surface)",
                border: `1px solid ${m.role === "user" ? "var(--border)" : "var(--border)"}`,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 14,
                lineHeight: 1.55,
              }}
            >
              {m.files.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: m.text ? 8 : 0 }}>
                  {m.files.map((f, fi) => (
                    <div
                      key={`${f.name}-${fi}`}
                      style={{
                        display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
                        borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)",
                        fontSize: 12.5,
                      }}
                    >
                      <Paperclip size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</span>
                      {f.data ? (
                        <button onClick={() => downloadFile(f)} aria-label="下载附件" style={{ color: "var(--accent)", padding: 2, flexShrink: 0 }}>
                          <Download size={13} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              {m.text}
              {m.active && <span style={{ color: "var(--accent)" }}>▍</span>}
            </div>
            {m.reasoning && (
              <details style={{ width: "88%", marginTop: 6 }}>
                <summary style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>思考过程</summary>
                <p style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "pre-wrap", marginTop: 6, lineHeight: 1.5 }}>{m.reasoning}</p>
              </details>
            )}
            {m.tools.length > 0 && (
              <div style={{ width: "88%", marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                {m.tools.map((t) => (
                  <div key={t.callID} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)" }}>
                    <Wrench size={12} style={{ color: "var(--accent)" }} />
                    <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.title ?? t.tool}
                    </span>
                    <span style={{ color: t.status === "completed" ? "var(--ok)" : t.status === "running" ? "var(--warn)" : "var(--muted)" }}>
                      {t.status === "completed" ? "完成" : t.status === "running" ? "执行中" : t.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: "10px 14px calc(10px + env(safe-area-inset-bottom))", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
        <input
          ref={fileInput}
          type="file"
          multiple
          onChange={pickFiles}
          style={{ display: "none" }}
        />
        {attachments.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {attachments.map((f, i) => (
              <span
                key={`${f.filename}-${i}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px",
                  borderRadius: 999, border: "1px solid var(--border)", background: "var(--surface)",
                  fontSize: 12.5,
                }}
              >
                <Paperclip size={11} style={{ color: "var(--accent)" }} />
                <span style={{ maxWidth: 180, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.filename}</span>
                <button
                  onClick={() => setAttachments((prev) => prev.filter((_, x) => x !== i))}
                  aria-label="移除附件"
                  style={{ color: "var(--muted)", padding: 1 }}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <button
            onClick={() => fileInput.current?.click()}
            aria-label="添加附件"
            title="添加附件"
            style={{ padding: "10px", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", flexShrink: 0 }}
          >
            <Paperclip size={16} />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="输入消息…"
            rows={Math.min(4, Math.max(1, input.split("\n").length))}
            style={{
              flex: 1,
              resize: "none",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              fontSize: 14,
              outline: "none",
              lineHeight: 1.4,
            }}
          />
          <button
            className="btn-primary"
            onClick={() => void send()}
            disabled={(!input.trim() && attachments.length === 0) || sending}
            style={{ padding: "10px 12px" }}
            aria-label="发送"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
