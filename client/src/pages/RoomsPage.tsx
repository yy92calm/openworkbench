import { useEffect, useRef, useState } from "react";
import {
  createRoom,
  validateInvite,
  joinRoom,
  onRoomEvent,
  sendMessage,
  sendFileMessage,
  uploadRoomBlob,
  downloadRoomBlob,
  replyViewed,
  leaveRoom,
  getMyMemberId,
  decodeMessage,
  type RoomEvent,
  type RoomMessageItem,
} from "@/lib/roomConnection";
import type { RoomMember, RoomMessageRouted } from "@/protocol";

type Phase = "list" | "creating" | "joining" | "in-room";

export function RoomsPage() {
  const [phase, setPhase] = useState<Phase>("list");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [nickname, setNickname] = useState(() => {
    return localStorage.getItem("workbench.nickname") ?? "";
  });

  const saveNickname = (v: string) => {
    setNickname(v);
    localStorage.setItem("workbench.nickname", v);
  };

  const handleCreate = async () => {
    setError("");
    try {
      const code = await createRoom();
      setInviteCode(code);
      setPhase("in-room");
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    }
  };

  const handleJoin = async () => {
    setError("");
    if (!inviteCode.trim()) {
      setError("请输入邀请码");
      return;
    }
    try {
      const ok = await validateInvite(inviteCode.trim().toUpperCase());
      if (!ok) {
        setError("邀请码无效或会话已解散");
        return;
      }
      setInviteCode(inviteCode.trim().toUpperCase());
      setPhase("in-room");
    } catch (e) {
      setError(e instanceof Error ? e.message : "验证失败");
    }
  };

  if (phase === "in-room") {
    return (
      <RoomChat
        inviteCode={inviteCode}
        nickname={nickname || "匿名用户"}
        onLeave={() => {
          setPhase("list");
          setInviteCode("");
        }}
      />
    );
  }

  return (
    <div style={{ padding: 16, paddingBottom: 80 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>会话分享</h2>

      {phase === "list" && (
        <>
          <div className="field">
            <label>昵称</label>
            <input
              value={nickname}
              onChange={(e) => saveNickname(e.target.value)}
              placeholder="你的昵称"
            />
          </div>
          <button className="btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={handleCreate}>
            创建会话
          </button>
          <button
            className="btn-secondary"
            style={{ width: "100%", marginTop: 8 }}
            onClick={() => setPhase("joining")}
          >
            加入会话
          </button>
          <div style={{ marginTop: 24, fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
            <p>• 创建/加入会话后，与会话内成员实时通信</p>
            <p>• 支持文字、语音消息和文件传输</p>
            <p>• 消息不保存，刷新页面或退出后即消失</p>
            <p>• 新成员看不到加入前的历史消息</p>
          </div>
        </>
      )}

      {phase === "joining" && (
        <>
          <div className="field">
            <label>邀请码</label>
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="6 位邀请码"
              maxLength={6}
              style={{ textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace" }}
            />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={handleJoin}>
            加入
          </button>
          <button
            className="btn-secondary"
            style={{ width: "100%", marginTop: 8 }}
            onClick={() => {
              setPhase("list");
              setError("");
              setInviteCode("");
            }}
          >
            返回
          </button>
        </>
      )}

      {error && phase === "list" && <div className="error-text">{error}</div>}
    </div>
  );
}

// ── Room Chat View ───────────────────────────────────────────────────────

function RoomChat({ inviteCode, nickname, onLeave }: { inviteCode: string; nickname: string; onLeave: () => void }) {
  const [messages, setMessages] = useState<RoomMessageItem[]>([]);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [viewOnceMode, setViewOnceMode] = useState(false);
  const [viewingMessage, setViewingMessage] = useState<RoomMessageItem | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [busy, setBusy] = useState(false); // uploading or sending
  const cleanupRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef<number>(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const cleanup = joinRoom(inviteCode, nickname);
    cleanupRef.current = cleanup;
    const unsub = onRoomEvent((e: RoomEvent) => {
      switch (e.type) {
        case "joined":
          setConnected(true);
          setMembers([...e.data.members]);
          setError("");
          break;
        case "member-joined":
          setMembers((cur) => [...cur, e.data.member]);
          break;
        case "member-left":
          setMembers((cur) => cur.filter((m) => m.id !== e.data.memberId));
          break;
        case "message": {
          const m = e.data as RoomMessageRouted;
          const myId = getMyMemberId();
          const kind = (m.kind ?? "text") as "text" | "audio" | "file";
          const text = kind === "text" ? decodeMessage(m.ct, m.nonce) : "";
          setMessages((cur) => [
            ...cur,
            {
              messageId: m.messageId,
              from: m.from,
              fromMe: m.from === myId,
              text,
              kind,
              fileId: m.fileId,
              meta: m.meta,
              at: m.at,
              viewOnce: m.viewOnce,
            },
          ]);
          break;
        }
        case "message-viewed":
          setMessages((cur) =>
            cur.map((m) => (m.messageId === e.messageId ? { ...m, viewed: true } : m)),
          );
          break;
        case "error":
          setError(e.message);
          setConnected(false);
          break;
        case "disconnected":
          setConnected(false);
          break;
      }
    });
    return () => {
      unsub();
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || !connected) return;
    const messageId = sendMessage(input.trim(), { viewOnce: viewOnceMode });
    setMessages((cur) => [
      ...cur,
      {
        messageId,
        from: getMyMemberId(),
        fromMe: true,
        text: input.trim(),
        kind: "text",
        at: Date.now(),
        viewOnce: viewOnceMode,
      },
    ]);
    setInput("");
    setViewOnceMode(false);
  };

  // ── File attachment ────────────────────────────────────────────────────
  const handlePickFile = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so same file can be picked again
    if (!file || !connected) return;
    setBusy(true);
    try {
      const fileId = await uploadRoomBlob(file, {
        filename: file.name,
        mime: file.type || "application/octet-stream",
      });
      const messageId = sendFileMessage(
        fileId,
        "file",
        { filename: file.name, size: file.size, mime: file.type || "application/octet-stream" },
        { viewOnce: viewOnceMode },
      );
      setMessages((cur) => [
        ...cur,
        {
          messageId,
          from: getMyMemberId(),
          fromMe: true,
          text: "",
          kind: "file",
          fileId,
          meta: { filename: file.name, size: file.size, mime: file.type || "application/octet-stream" },
          at: Date.now(),
          viewOnce: viewOnceMode,
        },
      ]);
      setViewOnceMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "文件发送失败");
    } finally {
      setBusy(false);
    }
  };

  // ── Voice recording ───────────────────────────────────────────────────
  const startRecording = async () => {
    if (!connected) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recordedChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: mime });
        const duration = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));
        if (blob.size === 0) {
          setBusy(false);
          return;
        }
        setBusy(true);
        try {
          const fileId = await uploadRoomBlob(blob, { mime, duration });
          const messageId = sendFileMessage(
            fileId,
            "audio",
            { mime, size: blob.size, duration },
            { viewOnce: viewOnceMode },
          );
          setMessages((cur) => [
            ...cur,
            {
              messageId,
              from: getMyMemberId(),
              fromMe: true,
              text: "",
              kind: "audio",
              fileId,
              meta: { mime, size: blob.size, duration },
              at: Date.now(),
              viewOnce: viewOnceMode,
            },
          ]);
          setViewOnceMode(false);
        } catch (err) {
          setError(err instanceof Error ? err.message : "语音上传失败");
        } finally {
          setBusy(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      recordStartRef.current = Date.now();
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法访问麦克风");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    };
  }, []);

  // ── View-once ─────────────────────────────────────────────────────────
  const handleViewMessage = (msg: RoomMessageItem) => {
    if (!msg.viewOnce || msg.fromMe) return;
    setViewingMessage(msg);
    replyViewed(msg.messageId);
  };

  const closeViewOnce = () => {
    setViewingMessage(null);
    if (viewingMessage) {
      setMessages((cur) => cur.filter((m) => m.messageId !== viewingMessage.messageId));
    }
  };

  const handleLeave = () => {
    leaveRoom();
    cleanupRef.current?.();
    onLeave();
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div className="room-header">
        <button onClick={handleLeave} className="room-back">←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>会话 {inviteCode}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {connected ? `${members.length} 人在线` : "连接中…"}
          </div>
        </div>
        <button onClick={handleLeave} className="room-leave-btn">退出</button>
      </div>

      {error && <div className="room-error-banner">{error}</div>}
      {busy && <div className="room-busy-banner">上传中…</div>}

      {/* Messages */}
      <div ref={scrollRef} className="room-messages">
        {messages.length === 0 && (
          <div className="room-empty">
            <p>已加入会话 {inviteCode}</p>
            <p style={{ fontSize: 12, color: "var(--muted)" }}>仅能看到加入后的新消息</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.messageId} className={`room-msg ${m.fromMe ? "mine" : ""}`}>
            {!m.fromMe && (
              <div className="room-msg-from">
                {members.find((x) => x.id === m.from)?.nickname ?? "未知"}
              </div>
            )}
            {m.viewOnce && !m.fromMe ? (
              <button className="room-msg-viewonce" onClick={() => handleViewMessage(m)}>
                🔒 阅后即焚消息 — 点击查看
              </button>
            ) : m.viewOnce && m.fromMe ? (
              <div className={`room-msg-bubble ${m.viewed ? "viewed" : "pending"}`}>
                {m.viewed ? "✓ 已查看" : "🔒 等待查看…"}
              </div>
            ) : (
              <MessageContent msg={m} />
            )}
            <div className="room-msg-time">{formatTime(m.at)}</div>
          </div>
        ))}
      </div>

      {/* Input bar */}
      <div className="room-input-bar">
        <button
          className={`room-toggle ${viewOnceMode ? "active" : ""}`}
          onClick={() => setViewOnceMode(!viewOnceMode)}
          title="阅后即焚"
          disabled={recording}
        >
          🔒
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={viewOnceMode ? "阅后即焚消息…" : "输入消息…"}
          disabled={!connected || recording}
        />
        <button
          className="room-icon-btn"
          onClick={handlePickFile}
          disabled={!connected || recording || busy}
          title="发送文件"
        >
          📎
        </button>
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        {recording ? (
          <button
            className="room-record-btn recording"
            onClick={stopRecording}
            title="停止录音"
          >
            ● {recordSeconds}″
          </button>
        ) : (
          <button
            className="room-icon-btn"
            onClick={startRecording}
            disabled={!connected || busy}
            title="语音消息"
          >
            🎤
          </button>
        )}
        <button
          className="room-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || !connected || recording}
        >
          发送
        </button>
      </div>

      {/* View-once modal */}
      {viewingMessage && (
        <div className="viewonce-backdrop" onClick={closeViewOnce}>
          <div className="viewonce-modal" onClick={(e) => e.stopPropagation()}>
            <div className="viewonce-warning">🔒 此消息查看后即销毁，无法再次查看</div>
            <MessageContent msg={viewingMessage} />
            <button className="btn-primary" onClick={closeViewOnce}>
              我已看完
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Message content renderer ────────────────────────────────────────────

function MessageContent({ msg }: { msg: RoomMessageItem }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState("");

  const loadAudio = async () => {
    if (audioUrl || !msg.fileId) return;
    setAudioLoading(true);
    setAudioError("");
    try {
      const blob = await downloadRoomBlob(msg.fileId);
      setAudioUrl(URL.createObjectURL(blob));
    } catch (e) {
      setAudioError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setAudioLoading(false);
    }
  };

  if (msg.kind === "audio") {
    return (
      <div className="room-msg-audio">
        {audioUrl ? (
          <audio controls src={audioUrl} style={{ width: "100%" }} />
        ) : (
          <button className="room-msg-play" onClick={loadAudio} disabled={audioLoading}>
            {audioLoading ? "加载中…" : `▶ 语音 ${msg.meta?.duration ?? 0}″`}
          </button>
        )}
        {audioError && <div className="room-msg-error">{audioError}</div>}
      </div>
    );
  }

  if (msg.kind === "file") {
    return (
      <div className="room-msg-file">
        <a
          href="#"
          onClick={async (e) => {
            e.preventDefault();
            if (!msg.fileId) return;
            try {
              const blob = await downloadRoomBlob(msg.fileId);
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = msg.meta?.filename ?? "file";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (err) {
              // ignore
            }
          }}
        >
          📄 {msg.meta?.filename ?? "文件"} ({msg.meta?.size ?? 0} bytes)
        </a>
      </div>
    );
  }

  return <div className="room-msg-bubble">{msg.text}</div>;
}
