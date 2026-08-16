import { useEffect, useRef, useState } from "react";
import {
  createRoom,
  joinRoom,
  onRoomEvent,
  sendMessage,
  sendFileMessage,
  sendSessionShare,
  uploadRoomBlob,
  downloadRoomBlob,
  replyViewed,
  roomSetViewOnce,
  leaveRoom,
  getMyMemberId,
  decodeMessage,
  loadRecentRooms,
  recordRecentRoom,
  removeRecentRoom,
  type RoomEvent,
  type RoomMessageItem,
  type RecentRoom,
} from "@/lib/roomConnection";
import { getClient } from "@/lib/connection";
import { compressSession } from "@/lib/roomShare";
import { MarkdownView } from "@/components/MarkdownView";
import type { SessionMeta } from "@workbench/sdk";
import type { RoomMember, RoomMessageRouted } from "@/protocol";

type Phase = "list" | "creating" | "joining" | "in-room";

export function RoomsPage() {
  const [phase, setPhase] = useState<Phase>("list");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [creatorInitEnforce, setCreatorInitEnforce] = useState<boolean | undefined>(undefined);
  const [nickname, setNickname] = useState(() => {
    return localStorage.getItem("workbench.nickname") ?? "";
  });
  // Recent rooms: kept in React state, sourced from localStorage so the list
  // re-renders after create/join/delete.
  const [recent, setRecent] = useState<RecentRoom[]>(() => loadRecentRooms());
  const [nicknameOpen, setNicknameOpen] = useState(false);

  const saveNickname = (v: string) => {
    setNickname(v);
    localStorage.setItem("workbench.nickname", v);
  };

  const enterRoom = (code: string, opts?: { enforceViewOnce?: boolean }) => {
    setInviteCode(code);
    setError("");
    setPhase("in-room");
    setCreatorInitEnforce(opts?.enforceViewOnce);
  };

  const handleCreate = async () => {
    setError("");
    try {
      const code = await createRoom();
      recordRecentRoom(code, nickname);
      setRecent(loadRecentRooms());
      // Creator creates the room then joins first; pass enforceViewOnce=false
      // by default — creator can flip the switch inside the room.
      enterRoom(code, { enforceViewOnce: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    }
  };

  const handleJoin = () => {
    setError("");
    if (!inviteCode.trim()) {
      setError("请输入邀请码");
      return;
    }
    enterRoom(inviteCode.trim().toUpperCase());
  };

  const handlePickRecent = (code: string) => {
    setError("");
    enterRoom(code);
  };

  const handleRemoveRecent = (code: string) => {
    removeRecentRoom(code);
    setRecent(loadRecentRooms());
  };

  if (phase === "in-room") {
    return (
      <RoomChat
        inviteCode={inviteCode}
        nickname={nickname || "匿名用户"}
        creatorInitEnforce={creatorInitEnforce}
        onLeave={(errorMessage) => {
          setPhase("list");
          setInviteCode("");
          setCreatorInitEnforce(undefined);
          setRecent(loadRecentRooms());
          if (errorMessage) setError(errorMessage);
        }}
      />
    );
  }

  return (
    <div className="rooms-page">
      {/* Chat-app style header */}
      <div className="rooms-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 600 }}>会话分享</span>
          <button
            className="rooms-nickname-chip"
            onClick={() => setNicknameOpen((v) => !v)}
            title="修改昵称"
          >
            {nickname || "匿名用户"}
          </button>
        </div>
        {phase === "joining" ? (
          <button className="rooms-header-action" onClick={() => { setPhase("list"); setError(""); setInviteCode(""); }}>
            返回
          </button>
        ) : (
          <button className="rooms-header-action" onClick={() => setPhase("joining")}>
            加入会话
          </button>
        )}
      </div>

      {nicknameOpen && (
        <div className="rooms-nickname-row">
          <input
            value={nickname}
            onChange={(e) => saveNickname(e.target.value)}
            placeholder="你的昵称"
            autoFocus
          />
        </div>
      )}

      {phase === "joining" && (
        <div className="rooms-join">
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
        </div>
      )}

      {/* Recent rooms as chat list */}
      <div className="rooms-list">
        {recent.length === 0 && (
          <div className="rooms-empty">
            <p style={{ fontSize: 14 }}>还没有会话</p>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              创建或加入一个会话，与远程客户端实时通信
            </p>
          </div>
        )}
        {recent.map((r) => (
          <div key={r.inviteCode} className="rooms-list-item">
            <button
              className="rooms-list-main"
              onClick={() => handlePickRecent(r.inviteCode)}
            >
              <span className="rooms-list-avatar">{r.inviteCode[0]}</span>
              <span className="rooms-list-body">
                <span className="rooms-list-title">
                  <span className="rooms-list-code">{r.inviteCode}</span>
                  <span className="rooms-list-time">{formatRelativeTime(r.lastVisitedAt)}</span>
                </span>
                <span className="rooms-list-sub">点击进入会话</span>
              </span>
            </button>
            <button
              className="rooms-list-remove"
              onClick={() => handleRemoveRecent(r.inviteCode)}
              aria-label="删除"
              title="从列表删除"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Bottom action bar */}
      <div className="rooms-actions">
        <button className="btn-primary" style={{ flex: 1 }} onClick={handleCreate}>
          ＋ 创建会话
        </button>
        <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setPhase("joining")}>
          加入会话
        </button>
      </div>

      {error && phase === "list" && <div className="error-text">{error}</div>}
    </div>
  );
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

// ── Room Chat View ───────────────────────────────────────────────────────

function RoomChat({ inviteCode, nickname, creatorInitEnforce, onLeave }: {
  inviteCode: string;
  nickname: string;
  creatorInitEnforce?: boolean;
  /** Called when the user leaves manually, or automatically after a fatal
      join error (e.g. the room was destroyed). errorMessage is only set for
      the auto-return path, so the list can surface the reason. */
  onLeave: (errorMessage?: string) => void;
}) {
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
  // "/" session-share picker state.
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState("");
  // Room-level viewOnce flag (creator-controlled). When true, all outgoing
  // messages are forced viewOnce, and the per-message 🔒 toggle is hidden.
  const [enforceViewOnce, setEnforceViewOnce] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  // Destruction countdown started when the creator left (ms epoch deadline).
  // null = no countdown (creator present or room healthy).
  const [destroyExpiresAt, setDestroyExpiresAt] = useState<number | null>(null);
  // Tick every second so the countdown banner stays current.
  const [now, setNow] = useState(() => Date.now());
  // Track which message ids we've already acked with `room.message-viewed`
  // to avoid duplicate acks on re-renders / re-mounts.
  const ackedRef = useRef<Set<string>>(new Set());
  // Whether we've successfully joined the room. A `room.error` before that
  // (e.g. "room not found") is fatal — the room is gone, so return to the list.
  const joinedRef = useRef(false);
  // Timer for the auto-return to the list after a fatal join error.
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef<number>(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const cleanup = joinRoom(inviteCode, nickname, creatorInitEnforce !== undefined ? { enforceViewOnce: creatorInitEnforce } : undefined);
    cleanupRef.current = cleanup;
    const unsub = onRoomEvent((e: RoomEvent) => {
      switch (e.type) {
        case "joined":
          setConnected(true);
          joinedRef.current = true;
          setMembers([...e.data.members]);
          setError("");
          // Sync room-level viewOnce flag and creator status from the relay.
          setEnforceViewOnce(e.data.enforceViewOnce === true);
          setIsCreator(e.data.isCreator === true);
          setDestroyExpiresAt(e.data.destroyExpiresAt ?? null);
          // Record this room in the recent list now that we know it still
          // exists (the relay accepted our join).
          recordRecentRoom(inviteCode, nickname);
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
          const kind = (m.kind ?? "text") as "text" | "audio" | "file" | "session-share";
          const text = kind === "text" || kind === "session-share" ? decodeMessage(m.ct, m.nonce) : "";
          // The relay may force viewOnce on a room-level enforceViewOnce room.
          const viewOnce = m.viewOnce === true;
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
              viewOnce,
            },
          ]);
          // For regular (non-viewOnce) messages: ack "viewed" once on receipt
          // so the sender sees the "read" status. viewOnce messages are acked
          // when the recipient actually clicks to view.
          if (!viewOnce && m.from !== myId) {
            if (!ackedRef.current.has(m.messageId)) {
              ackedRef.current.add(m.messageId);
              replyViewed(m.messageId);
            }
          }
          break;
        }
        case "message-viewed":
          setMessages((cur) =>
            cur.map((m) => (m.messageId === e.messageId ? { ...m, viewed: true, read: true } : m)),
          );
          break;
        case "view-once-changed":
          setEnforceViewOnce(e.enforce);
          // Reset per-message toggle so the room flag takes precedence.
          setViewOnceMode(false);
          break;
        case "destroy-countdown":
          setDestroyExpiresAt(e.expiresAt);
          break;
        case "destroyed":
          // The room is gone — return to the list (same path as a fatal
          // join error), surfaced via the list-level error line.
          onLeave("房间已销毁");
          break;
        case "error":
          setError(e.message);
          setConnected(false);
          // A join-time error means the room is gone (destroyed). Show the
          // error briefly, then auto-return to the room list. Errors after a
          // successful join (e.g. permission errors) just surface the banner.
          if (!joinedRef.current && !returnTimerRef.current) {
            returnTimerRef.current = setTimeout(() => {
              returnTimerRef.current = null;
              onLeave(e.message);
            }, 1500);
          }
          break;
        case "disconnected":
          setConnected(false);
          break;
      }
    });
    return () => {
      unsub();
      cleanup();
      if (returnTimerRef.current) {
        clearTimeout(returnTimerRef.current);
        returnTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // While a destruction countdown is active, tick once per second so the
  // banner's remaining time stays current.
  useEffect(() => {
    if (destroyExpiresAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [destroyExpiresAt]);

  const handleSend = () => {
    if (!input.trim() || !connected) return;
    // Room-level flag takes precedence over the per-message toggle.
    const willViewOnce = enforceViewOnce || viewOnceMode;
    let messageId: string;
    try {
      messageId = sendMessage(input.trim(), { viewOnce: willViewOnce });
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败");
      return;
    }
    setMessages((cur) => [
      ...cur,
      {
        messageId,
        from: getMyMemberId(),
        fromMe: true,
        text: input.trim(),
        kind: "text",
        at: Date.now(),
        viewOnce: willViewOnce,
      },
    ]);
    setInput("");
    setViewOnceMode(false);
  };

  // ── Session share ("/") ───────────────────────────────────────────────
  const handleShareSession = async (session: SessionMeta) => {
    const client = getClient();
    if (!client) {
      setShareError("请先选择设备");
      return;
    }
    setShareBusy(true);
    setShareError("");
    const willViewOnce = enforceViewOnce || viewOnceMode;
    try {
      const messages = await client.getMessages(session.id);
      const payload = compressSession(session.title, session.id, messages);
      const messageId = sendSessionShare(payload, { viewOnce: willViewOnce });
      setMessages((cur) => [
        ...cur,
        {
          messageId,
          from: getMyMemberId(),
          fromMe: true,
          text: payload.summary,
          kind: "session-share",
          meta: { sessionTitle: payload.title, sessionId: payload.sessionId },
          at: Date.now(),
          viewOnce: willViewOnce,
        },
      ]);
      setInput("");
      setShareOpen(false);
      setViewOnceMode(false);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "分享失败");
    } finally {
      setShareBusy(false);
    }
  };

  // ── File attachment ────────────────────────────────────────────────────
  const handlePickFile = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so same file can be picked again
    if (!file || !connected) return;
    setBusy(true);
    const willViewOnce = enforceViewOnce || viewOnceMode;
    try {
      const fileId = await uploadRoomBlob(file, {
        filename: file.name,
        mime: file.type || "application/octet-stream",
      });
      const messageId = sendFileMessage(
        fileId,
        "file",
        { filename: file.name, size: file.size, mime: file.type || "application/octet-stream" },
        { viewOnce: willViewOnce },
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
          viewOnce: willViewOnce,
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
        const willViewOnce = enforceViewOnce || viewOnceMode;
        try {
          const fileId = await uploadRoomBlob(blob, { mime, duration });
          const messageId = sendFileMessage(
            fileId,
            "audio",
            { mime, size: blob.size, duration },
            { viewOnce: willViewOnce },
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
              viewOnce: willViewOnce,
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
    if (!ackedRef.current.has(msg.messageId)) {
      ackedRef.current.add(msg.messageId);
      replyViewed(msg.messageId);
    }
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

  /** Format the remaining time until `expiresAt` as HH:MM:SS. */
  const formatCountdown = (expiresAt: number) => {
    const remain = Math.max(0, expiresAt - now);
    const totalSec = Math.floor(remain / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div className="room-header">
        <button onClick={handleLeave} className="room-back">←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>会话 {inviteCode}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {connected ? `${members.length} 人在线` : "连接中…"}
          </div>
        </div>
        {/* Creator-only toggle: enforce viewOnce for the whole room */}
        {isCreator && (
          <button
            className={`room-toggle ${enforceViewOnce ? "active" : ""}`}
            onClick={() => roomSetViewOnce(!enforceViewOnce)}
            title={enforceViewOnce ? "已开启房间阅后即焚" : "开启房间阅后即焚"}
            disabled={!connected}
            style={{ marginRight: 8 }}
          >
            {enforceViewOnce ? "🔒 强制阅后即焚" : "🔓 默认模式"}
          </button>
        )}
        <button onClick={handleLeave} className="room-leave-btn">退出</button>
      </div>

      {error && <div className="room-error-banner">{error}</div>}
      {busy && <div className="room-busy-banner">上传中…</div>}
      {destroyExpiresAt !== null && (
        <div className="room-countdown-banner">
          ⚠️ 创建者已离开，房间将在 {formatCountdown(destroyExpiresAt)} 后销毁
        </div>
      )}

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
            <div className="room-msg-from">
              {members.find((x) => x.id === m.from)?.nickname ?? "未知"}
            </div>
            {m.viewOnce && !m.fromMe ? (
              <button className="room-msg-viewonce" onClick={() => handleViewMessage(m)}>
                🔒 阅后即焚消息 — 点击查看
              </button>
            ) : m.viewOnce && m.fromMe ? (
              <div className={`room-msg-bubble ${m.viewed ? "viewed" : "pending"}`}>
                {m.viewed ? "✓ 已查看" : "🔒 等待查看…"}
              </div>
            ) : (
              <>
                <MessageContent msg={m} />
                {/* Read receipt: show "已读" only on my own regular messages
                    after the recipient acked. */}
                {m.fromMe && m.read && (
                  <div className="room-msg-read">已读</div>
                )}
              </>
            )}
            <div className="room-msg-time">{formatTime(m.at)}</div>
          </div>
        ))}
      </div>

      {/* Input bar */}
      <div className="room-input-wrap">
        {shareOpen && (
          <SessionSharePicker
            busy={shareBusy}
            error={shareError}
            onPick={(s) => void handleShareSession(s)}
            onClose={() => { setShareOpen(false); setShareError(""); }}
          />
        )}
        <div className="room-input-bar">
        {/* Per-message 🔒 toggle is hidden when the room enforces viewOnce:
            all messages are forced viewOnce anyway. */}
        {!enforceViewOnce && (
          <button
            className={`room-toggle ${viewOnceMode ? "active" : ""}`}
            onClick={() => setViewOnceMode(!viewOnceMode)}
            title="阅后即焚"
            disabled={recording}
          >
            🔒
          </button>
        )}
        <input
          value={input}
          onChange={(e) => {
            const v = e.target.value;
            setInput(v);
            // "/" opens the session-share picker (Slack-style command).
            setShareOpen(v.startsWith("/"));
            if (v.startsWith("/")) setShareError("");
          }}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={enforceViewOnce || viewOnceMode ? "阅后即焚消息…" : "输入消息…（/ 分享历史会话）"}
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

// ── Session share picker ("/") ─────────────────────────────────────────

function SessionSharePicker({ busy, error, onPick, onClose }: {
  busy: boolean;
  error: string;
  onPick: (session: SessionMeta) => void;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const client = getClient();
    if (!client) {
      setLoading(false);
      return;
    }
    client.listSessions()
      .then((list) => { if (!cancelled) setSessions(list); })
      .catch(() => { /* surfaced via parent error */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="room-share-picker">
      <div className="room-share-header">
        <span>分享历史会话</span>
        <button onClick={onClose} className="room-share-close" aria-label="关闭">×</button>
      </div>
      {error && <div className="room-share-error">{error}</div>}
      {!getClient() && <div className="room-share-error">请先在顶部选择设备</div>}
      {loading ? (
        <div className="room-share-empty">加载中…</div>
      ) : sessions.length === 0 ? (
        <div className="room-share-empty">暂无历史会话</div>
      ) : (
        <div className="room-share-list">
          {sessions.map((s) => (
            <button
              key={s.id}
              className="room-share-item"
              onClick={() => onPick(s)}
              disabled={busy}
            >
              <span className="room-share-item-title">{s.title || "未命名会话"}</span>
              <span className="room-share-item-time">
                {s.updatedAt != null
                  ? new Date(s.updatedAt).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                  : ""}
              </span>
            </button>
          ))}
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

  if (msg.kind === "session-share") {
    return <SessionShareCard msg={msg} />;
  }

  return <div className="room-msg-bubble">{msg.text}</div>;
}

/** Collapsible card for a shared session: shows the title + preview, expands
 *  to reveal the compressed conversation summary. */
function SessionShareCard({ msg }: { msg: RoomMessageItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`room-msg-share ${open ? "open" : ""}`}>
      <button className="room-msg-share-head" onClick={() => setOpen((v) => !v)}>
        <span className="room-msg-share-icon">📎</span>
        <span className="room-msg-share-title">会话分享：{msg.meta?.sessionTitle ?? "未命名会话"}</span>
        <span className="room-msg-share-toggle">{open ? "收起" : "展开查看"}</span>
      </button>
      {open && (
        <div className="room-msg-share-body">
          <MarkdownView>{msg.text}</MarkdownView>
        </div>
      )}
    </div>
  );
}
