import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Send, Wrench, Square } from "lucide-react";
import type { OpenCodeEvent, HistoryMessage } from "@workbench/sdk";
import { getClient } from "@/lib/connection";

interface ToolRow {
  callID: string;
  tool: string;
  title?: string;
  status: string;
}

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
  tools: ToolRow[];
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
  return { id: `h${idx}`, role: m.role, text, reasoning: reasoning || undefined, tools, active: false };
}

export function SessionPage({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeId = useRef<string | null>(null);

  const scroll = () => bottomRef.current?.scrollIntoView({ behavior: "smooth" });

  // Load history + subscribe to live events for this session.
  useEffect(() => {
    const client = getClient();
    if (!client) return;
    let unsub = () => {};
    void (async () => {
      try {
        const history = await client.getMessages(sessionId);
        setMessages(history.map(toMsg));
      } catch {
        /* history may be unavailable for brand-new sessions */
      }
      unsub = client.onEvent((e: OpenCodeEvent) => {
        if (e.sessionId !== sessionId) return;
        setMessages((prev) => {
          const next = [...prev];
          const active = next.find((m) => m.active);
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
      });
    })();
    return () => unsub();
  }, [sessionId]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const client = getClient();
    if (!client) return;
    setInput("");
    setSending(true);
    const id = `a${Date.now()}`;
    activeId.current = id;
    setMessages((prev) => [
      ...prev,
      { id: `u${Date.now()}`, role: "user", text, tools: [], active: false },
      { id, role: "assistant", text: "", tools: [], active: true },
    ]);
    scroll();
    try {
      await client.sendPrompt(sessionId, text);
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: m.text || "（发送失败）", active: false } : m)));
      setSending(false);
    }
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

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
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
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
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
            disabled={!input.trim() || sending}
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
