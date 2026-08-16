import { useEffect, useState, useRef, useCallback } from "react";
import { ArrowLeft, Lock, Plus, Radio, Paperclip, Mic } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  roomCreate,
  roomValidate,
  roomJoin,
  roomLeave,
  roomSend,
  roomPickFile,
  roomUploadFile,
  roomUploadBlob,
  roomSendFile,
  roomDownloadFile,
  roomViewed,
  onRoomEvent,
  type RoomStatus,
  type RoomMember,
  type RoomEvent,
  type RoomMessageMeta,
} from "@/lib/electron";

type Phase = "list" | "joining" | "in-room";
type ChatMessage = {
  messageId: string;
  from: string;
  fromMe: boolean;
  text: string;
  kind: "text" | "audio" | "file";
  fileId?: string;
  meta?: RoomMessageMeta;
  at: number;
  viewOnce?: boolean;
  viewed?: boolean;
};

export function RoomsPage() {
  const [phase, setPhase] = useState<Phase>("list");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [nickname, setNickname] = useState(() => localStorage.getItem("workbench.host.nickname") ?? "Host");

  const saveNickname = (v: string) => {
    setNickname(v);
    localStorage.setItem("workbench.host.nickname", v);
  };

  const handleCreate = async () => {
    setError("");
    try {
      const { inviteCode: code } = await roomCreate();
      setInviteCode(code);
      setPhase("in-room");
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    }
  };

  const handleJoin = async () => {
    setError("");
    const code = inviteCode.trim().toUpperCase();
    if (!code) {
      setError("请输入邀请码");
      return;
    }
    try {
      const ok = await roomValidate(code);
      if (!ok) {
        setError("邀请码无效或会话已解散");
        return;
      }
      setInviteCode(code);
      setPhase("in-room");
    } catch (e) {
      setError(e instanceof Error ? e.message : "验证失败");
    }
  };

  if (phase === "in-room") {
    return (
      <RoomChat
        inviteCode={inviteCode}
        nickname={nickname || "Host"}
        onLeave={() => {
          setPhase("list");
          setInviteCode("");
        }}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text">会话分享</h1>
          <p className="mt-1 text-sm text-muted">
            创建或加入端到端加密的实时通信会话，与远程客户端协作
          </p>
        </div>

        {phase === "list" && (
          <div className="mt-6 space-y-4">
            <div className="rounded-card border border-border bg-surface p-4">
              <label className="block text-xs font-medium uppercase tracking-wider text-muted">昵称</label>
              <input
                value={nickname}
                onChange={(e) => saveNickname(e.target.value)}
                className="mt-2 w-full rounded-input border border-border-soft bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                placeholder="你的昵称"
              />
            </div>
            <button
              className="flex w-full items-center justify-center gap-1.5 rounded-input bg-accent px-3 py-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
              onClick={handleCreate}
            >
              <Plus size={16} />
              创建会话
            </button>
            <button
              className="flex w-full items-center justify-center gap-1.5 rounded-input border border-border bg-surface px-3 py-2.5 text-sm font-medium text-text hover:bg-surface-2"
              onClick={() => setPhase("joining")}
            >
              <Radio size={16} />
              加入会话
            </button>

            <div className="rounded-card border border-border-soft/60 bg-surface/40 p-4 text-xs text-muted">
              <ul className="space-y-1.5 leading-relaxed">
                <li>• 创建/加入会话后，与会话内成员实时通信</li>
                <li>• 支持文字、语音消息和文件传输（图片 / Word / Excel 等）</li>
                <li>• 消息不保存，刷新页面或退出后即消失</li>
                <li>• 新成员看不到加入前的历史消息</li>
                <li>• 阅后即焚消息查看后立即销毁</li>
              </ul>
            </div>
          </div>
        )}

        {phase === "joining" && (
          <div className="mt-6 space-y-4">
            <div className="rounded-card border border-border bg-surface p-4">
              <label className="block text-xs font-medium uppercase tracking-wider text-muted">邀请码</label>
              <input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="6 位邀请码"
                maxLength={6}
                className="mt-2 w-full rounded-input border border-border-soft bg-bg px-3 py-2 text-center font-mono text-base tracking-[0.3em] text-text outline-none focus:border-accent/40"
              />
            </div>
            {error && <div className="rounded-input bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</div>}
            <button
              className="flex w-full items-center justify-center gap-1.5 rounded-input bg-accent px-3 py-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
              onClick={handleJoin}
            >
              加入
            </button>
            <button
              className="flex w-full items-center justify-center gap-1.5 rounded-input border border-border bg-surface px-3 py-2.5 text-sm font-medium text-text hover:bg-surface-2"
              onClick={() => {
                setPhase("list");
                setError("");
                setInviteCode("");
              }}
            >
              返回
            </button>
          </div>
        )}

        {error && phase === "list" && (
          <div className="mt-4 rounded-input bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</div>
        )}
      </div>
    </div>
  );
}

// ── Room Chat ────────────────────────────────────────────────────────────

function RoomChat({ inviteCode, nickname, onLeave }: { inviteCode: string; nickname: string; onLeave: () => void }) {
  const [status, setStatus] = useState<RoomStatus>("connecting");
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [viewOnceMode, setViewOnceMode] = useState(false);
  const [viewingMessage, setViewingMessage] = useState<ChatMessage | null>(null);
  const [myMemberId, setMyMemberId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false); // uploading or sending file
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef<number>(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const myMemberIdRef = useRef("");

  // Keep a ref of myMemberId so the event handler closure sees the latest value.
  useEffect(() => { myMemberIdRef.current = myMemberId; }, [myMemberId]);

  // Join the room on mount.
  useEffect(() => {
    void roomJoin(inviteCode, nickname);
    return () => {
      void roomLeave();
    };
  }, [inviteCode, nickname]);

  // Subscribe to room events.
  useEffect(() => {
    const unsub = onRoomEvent((e: RoomEvent) => {
      switch (e.type) {
        case "status":
          setStatus(e.status);
          setError(e.status === "error" ? "连接异常，正在重连…" : "");
          break;
        case "joined":
          setMembers(e.members);
          setMyMemberId(
            e.members.find((m) => m.nickname === nickname)?.id ??
            e.members[e.members.length - 1]?.id ?? "",
          );
          break;
        case "member-joined":
          setMembers((cur) => [...cur, e.member]);
          break;
        case "member-left":
          setMembers((cur) => cur.filter((m) => m.id !== e.memberId));
          break;
        case "message": {
          const kind = (e.msg.kind ?? "text") as "text" | "audio" | "file";
          const text = kind === "text" ? decodeMessage(e.msg.ct) : "";
          setMessages((cur) => [
            ...cur,
            {
              messageId: e.msg.messageId,
              from: e.msg.from,
              fromMe: e.msg.from === myMemberIdRef.current,
              text,
              kind,
              fileId: e.msg.fileId,
              meta: e.msg.meta,
              at: e.msg.at,
              viewOnce: e.msg.viewOnce,
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
          break;
      }
    });
    return unsub;
  }, [nickname]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || status !== "joined") return;
    try {
      const messageId = await roomSend(text, viewOnceMode);
      setMessages((cur) => [
        ...cur,
        {
          messageId,
          from: myMemberId,
          fromMe: true,
          text,
          kind: "text",
          at: Date.now(),
          viewOnce: viewOnceMode,
        },
      ]);
      setInput("");
      setViewOnceMode(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败");
    }
  }, [input, status, viewOnceMode, myMemberId]);

  // ── File attachment ─────────────────────────────────────────────────────
  const handlePickFile = useCallback(async () => {
    if (status !== "joined" || busy) return;
    try {
      const picked = await roomPickFile();
      if (!picked) return;
      setBusy(true);
      setError("");
      const { fileId } = await roomUploadFile(picked.path, {
        filename: picked.name,
        mime: picked.mime,
      });
      const meta: RoomMessageMeta = {
        filename: picked.name,
        size: picked.size,
        mime: picked.mime,
      };
      const messageId = await roomSendFile(fileId, "file", meta, viewOnceMode);
      setMessages((cur) => [
        ...cur,
        {
          messageId,
          from: myMemberId,
          fromMe: true,
          text: "",
          kind: "file",
          fileId,
          meta,
          at: Date.now(),
          viewOnce: viewOnceMode,
        },
      ]);
      setViewOnceMode(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "文件发送失败");
    } finally {
      setBusy(false);
    }
  }, [status, busy, viewOnceMode, myMemberId]);

  // ── Voice recording (Electron renderer supports MediaRecorder) ─────────
  const startRecording = useCallback(async () => {
    if (status !== "joined" || busy) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
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
        try {
          setBusy(true);
          // Convert blob to base64 and send via IPC to the main process,
          // which uploads it to the relay.
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          const chunkSize = 0x8000;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)) as unknown as number[]);
          }
          const base64 = btoa(binary);
          const { fileId } = await roomUploadBlob(base64, { mime, duration });
          const meta: RoomMessageMeta = { mime, size: blob.size, duration };
          const messageId = await roomSendFile(fileId, "audio", meta, viewOnceMode);
          setMessages((cur) => [
            ...cur,
            {
              messageId,
              from: myMemberId,
              fromMe: true,
              text: "",
              kind: "audio",
              fileId,
              meta,
              at: Date.now(),
              viewOnce: viewOnceMode,
            },
          ]);
          setViewOnceMode(false);
        } catch (e) {
          setError(e instanceof Error ? e.message : "语音上传失败");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法访问麦克风");
    }
  }, [status, busy, viewOnceMode, myMemberId]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    };
  }, []);

  const handleViewMessage = async (msg: ChatMessage) => {
    if (!msg.viewOnce || msg.fromMe) return;
    setViewingMessage(msg);
    await roomViewed(msg.messageId);
  };

  const closeViewOnce = () => {
    if (viewingMessage) {
      setMessages((cur) => cur.filter((m) => m.messageId !== viewingMessage.messageId));
    }
    setViewingMessage(null);
  };

  const handleLeave = async () => {
    await roomLeave();
    onLeave();
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const online = status === "joined";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <button
          onClick={handleLeave}
          className="rounded-input p-1 text-muted hover:bg-surface-2 hover:text-text"
          aria-label="返回"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="text-sm font-semibold text-text">会话 {inviteCode}</div>
          <div className="text-xs text-muted">
            {online ? `${members.length} 人在线` : status === "connecting" ? "连接中…" : "未连接"}
          </div>
        </div>
        <button
          onClick={handleLeave}
          className="rounded-input border border-border px-2.5 py-1 text-xs text-red-500 hover:bg-red-500/10"
        >
          退出
        </button>
      </div>

      {error && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-center text-xs text-red-500">
          {error}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messages.length === 0 && (
            <div className="mt-12 text-center text-sm text-muted">
              <p>已加入会话 {inviteCode}</p>
              <p className="mt-1 text-xs">仅能看到加入后的新消息</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.messageId} className={cn("flex flex-col", m.fromMe ? "items-end" : "items-start")}>
              {!m.fromMe && (
                <div className="mb-0.5 px-1 text-xs text-muted">
                  {members.find((x) => x.id === m.from)?.nickname ?? "未知"}
                </div>
              )}
              {m.viewOnce && !m.fromMe ? (
                <button
                  onClick={() => handleViewMessage(m)}
                  className="rounded-2xl border border-dashed border-accent bg-surface-2 px-3 py-2 text-left text-sm text-accent hover:bg-surface"
                >
                  <Lock size={12} className="mr-1 inline" />
                  阅后即焚消息 — 点击查看
                </button>
              ) : m.viewOnce && m.fromMe ? (
                <div className={cn(
                  "rounded-2xl px-3 py-2 text-xs italic",
                  m.viewed ? "bg-surface-2/50 text-muted" : "bg-accent/30 text-accent",
                )}>
                  {m.viewed ? "✓ 已查看" : "🔒 等待查看…"}
                </div>
              ) : (
                <MessageContent msg={m} fromMe={m.fromMe} />
              )}
              <div className="mt-0.5 px-1 text-[10px] text-muted">{formatTime(m.at)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-surface px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <button
            onClick={() => setViewOnceMode(!viewOnceMode)}
            disabled={recording || busy}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
              viewOnceMode ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface-2 text-muted hover:text-text",
            )}
            title="阅后即焚"
          >
            <Lock size={15} />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSend())}
            placeholder={viewOnceMode ? "阅后即焚消息…" : "输入消息…"}
            disabled={!online || recording}
            className="flex-1 rounded-full border border-border-soft bg-bg px-4 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-accent/40 disabled:opacity-50"
          />
          <button
            onClick={handlePickFile}
            disabled={!online || recording || busy}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-muted hover:text-text disabled:opacity-40"
            title="发送文件"
          >
            <Paperclip size={15} />
          </button>
          {recording ? (
            <button
              onClick={stopRecording}
              className="flex shrink-0 items-center gap-1 rounded-full bg-red-500 px-3 py-2 text-sm font-medium text-white hover:opacity-90"
              title="停止录音"
            >
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
              {recordSeconds}″
            </button>
          ) : (
            <button
              onClick={startRecording}
              disabled={!online || busy}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-muted hover:text-text disabled:opacity-40"
              title="语音消息"
            >
              <Mic size={15} />
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={!input.trim() || !online || recording}
            className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            发送
          </button>
        </div>
        {busy && (
          <div className="mx-auto mt-1 max-w-3xl text-center text-xs text-muted">上传中…</div>
        )}
      </div>

      {/* View-once modal */}
      {viewingMessage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={closeViewOnce}
        >
          <div
            className="w-full max-w-md rounded-card border border-border bg-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 text-center text-xs text-red-500">
              <Lock size={12} className="mr-1 inline" />
              此消息查看后即销毁，无法再次查看
            </div>
            <MessageContent msg={viewingMessage} fromMe={false} embedded />
            <button
              onClick={closeViewOnce}
              className="mt-4 w-full rounded-input bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
            >
              我已看完
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Message content renderer ─────────────────────────────────────────────

function MessageContent({
  msg,
  fromMe,
  embedded,
}: {
  msg: ChatMessage;
  fromMe: boolean;
  embedded?: boolean;
}) {
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState("");

  const loadAudio = async () => {
    if (audioPath || !msg.fileId) return;
    setAudioLoading(true);
    setAudioError("");
    try {
      const { path } = await roomDownloadFile(msg.fileId, `voice-${msg.messageId}.webm`);
      setAudioPath(path);
    } catch (e) {
      setAudioError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setAudioLoading(false);
    }
  };

  const handleSaveFile = async () => {
    if (!msg.fileId) return;
    try {
      await roomDownloadFile(msg.fileId, msg.meta?.filename);
    } catch (e) {
      setAudioError(e instanceof Error ? e.message : "下载失败");
    }
  };

  const bubble = cn(
    "rounded-2xl px-3 py-2 text-sm",
    embedded ? "min-h-[60px] border border-border-soft bg-bg leading-relaxed" : (
      fromMe
        ? "max-w-[80%] rounded-tr-sm bg-accent text-accent-fg"
        : "max-w-[80%] rounded-tl-sm border border-border bg-surface text-text"
    ),
  );

  if (msg.kind === "audio") {
    return (
      <div className={cn(bubble, "min-w-[180px]")}>
        {audioPath ? (
          <audio controls src={`file://${audioPath}`} className="w-full" />
        ) : (
          <button
            onClick={loadAudio}
            disabled={audioLoading}
            className="text-left text-xs hover:underline"
          >
            {audioLoading ? "加载中…" : `▶ 语音 ${msg.meta?.duration ?? 0}″`}
          </button>
        )}
        {audioError && <div className="mt-1 text-[10px] text-red-500">{audioError}</div>}
      </div>
    );
  }

  if (msg.kind === "file") {
    return (
      <div className={bubble}>
        <button
          onClick={handleSaveFile}
          className="text-left text-xs text-accent hover:underline break-all"
        >
          📄 {msg.meta?.filename ?? "文件"} ({formatSize(msg.meta?.size)})
        </button>
      </div>
    );
  }

  return (
    <div className={cn(bubble, "whitespace-pre-wrap break-words")}>{msg.text}</div>
  );
}

/** Decode a base64-encoded message (placeholder until E2E crypto lands). */
function decodeMessage(ct: string): string {
  try {
    // Browser-safe base64 decode.
    const bin = atob(ct);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "(无法解码)";
  }
}
