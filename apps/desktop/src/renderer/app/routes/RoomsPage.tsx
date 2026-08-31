import { ArrowLeft, Lock, Mic, Paperclip, Plus, Radio, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { MarkdownViewer } from '@/components/markdown-viewer/MarkdownViewer';
import { cn } from '@/lib/cn';
import {
  onRoomEvent,
  roomCreate,
  roomDownloadFile,
  type RoomEvent,
  roomJoin,
  roomLeave,
  type RoomMember,
  type RoomMessageMeta,
  roomPickFile,
  roomSend,
  roomSendFile,
  roomSendSessionShare,
  roomSetViewOnce,
  type RoomStatus,
  roomUploadBlob,
  roomUploadFile,
  roomViewed,
} from '@/lib/electron';
import { compressSession } from '@/lib/roomShare';
import { getClient } from '@/lib/runtime';

// ── Recent rooms (local-only history for the "recent rooms" list) ──────────
// Mirrors the client-side helper. Same localStorage key on both sides; since
// desktop and web client run in separate processes their storage is isolated
// in practice, but the key is identical so a future sync layer can reuse it.

const RECENT_ROOMS_KEY = 'workbench.rooms.recent';
const RECENT_ROOMS_MAX = 20;

interface RecentRoom {
  inviteCode: string;
  nickname: string;
  joinedAt: number;
  lastVisitedAt: number;
}

function loadRecentRooms(): RecentRoom[] {
  try {
    const raw = localStorage.getItem(RECENT_ROOMS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as RecentRoom[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function recordRecentRoom(inviteCode: string, nickname: string): void {
  const now = Date.now();
  const existing = loadRecentRooms();
  const idx = existing.findIndex((r) => r.inviteCode === inviteCode);
  if (idx >= 0) {
    const item = existing[idx];
    existing.splice(idx, 1);
    existing.unshift({
      inviteCode,
      nickname: nickname || item.nickname,
      joinedAt: item.joinedAt,
      lastVisitedAt: now,
    });
  } else {
    existing.unshift({ inviteCode, nickname, joinedAt: now, lastVisitedAt: now });
  }
  try {
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(existing.slice(0, RECENT_ROOMS_MAX)));
  } catch {
    /* ignore */
  }
}

function removeRecentRoom(inviteCode: string): void {
  const existing = loadRecentRooms().filter((r) => r.inviteCode !== inviteCode);
  try {
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(existing));
  } catch {
    /* ignore */
  }
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

type Phase = 'list' | 'joining' | 'in-room';
type ChatMessage = {
  messageId: string;
  from: string;
  fromMe: boolean;
  text: string;
  kind: 'text' | 'audio' | 'file' | 'session-share';
  fileId?: string;
  meta?: RoomMessageMeta;
  at: number;
  viewOnce?: boolean;
  /** viewOnce: recipient has clicked "view" and the message is now burned. */
  viewed?: boolean;
  /** Regular message: recipient has acked "viewed" (read receipt). */
  read?: boolean;
};

export function RoomsPage() {
  const [phase, setPhase] = useState<Phase>('list');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [creatorInitEnforce, setCreatorInitEnforce] = useState<boolean | undefined>(undefined);
  const [nickname, setNickname] = useState(
    () => localStorage.getItem('workbench.host.nickname') ?? 'Host',
  );
  const [nicknameOpen, setNicknameOpen] = useState(false);
  // Recent rooms: kept in React state, sourced from localStorage so the list
  // re-renders after create/join/delete.
  const [recent, setRecent] = useState<RecentRoom[]>(() => loadRecentRooms());

  const saveNickname = (v: string) => {
    setNickname(v);
    localStorage.setItem('workbench.host.nickname', v);
  };

  const enterRoom = (code: string, opts?: { enforceViewOnce?: boolean }) => {
    setInviteCode(code);
    setError('');
    setCreatorInitEnforce(opts?.enforceViewOnce);
    setPhase('in-room');
  };

  const handleCreate = async () => {
    setError('');
    try {
      const { inviteCode: code } = await roomCreate();
      recordRecentRoom(code, nickname);
      setRecent(loadRecentRooms());
      // Creator creates the room then joins first; pass enforceViewOnce=false
      // by default — creator can flip the switch inside the room.
      enterRoom(code, { enforceViewOnce: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    }
  };

  const handleJoin = () => {
    setError('');
    const code = inviteCode.trim().toUpperCase();
    if (!code) {
      setError('请输入邀请码');
      return;
    }
    // No pre-validation: the relay will reject the join with `room.error` if
    // the room no longer exists; the chat view surfaces that error.
    enterRoom(code);
  };

  const handlePickRecent = (code: string) => {
    setError('');
    enterRoom(code);
  };

  const handleRemoveRecent = (code: string) => {
    removeRecentRoom(code);
    setRecent(loadRecentRooms());
  };

  if (phase === 'in-room') {
    return (
      <RoomChat
        inviteCode={inviteCode}
        nickname={nickname || 'Host'}
        creatorInitEnforce={creatorInitEnforce}
        onLeave={(errorMessage) => {
          setPhase('list');
          setInviteCode('');
          setCreatorInitEnforce(undefined);
          setRecent(loadRecentRooms());
          if (errorMessage) setError(errorMessage);
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Chat-app style header */}
      <div className="flex items-center gap-3 border-b border-border bg-surface px-6 py-4">
        <div className="flex flex-1 items-center gap-2 min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-text">会话分享</h1>
          <button
            onClick={() => setNicknameOpen((v) => !v)}
            title="修改昵称"
            className="max-w-[160px] truncate rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs text-muted hover:text-text"
          >
            {nickname || '匿名用户'}
          </button>
        </div>
        {phase === 'joining' ? (
          <button
            className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:text-text"
            onClick={() => {
              setPhase('list');
              setError('');
              setInviteCode('');
            }}
          >
            返回
          </button>
        ) : (
          <button
            className="flex items-center gap-1 rounded-input border border-border px-3 py-1.5 text-xs font-medium text-accent hover:bg-surface-2"
            onClick={() => setPhase('joining')}
          >
            <Radio size={13} />
            加入会话
          </button>
        )}
      </div>

      {nicknameOpen && (
        <div className="border-b border-border bg-surface px-6 py-3">
          <input
            value={nickname}
            onChange={(e) => saveNickname(e.target.value)}
            placeholder="你的昵称"
            autoFocus
            className="w-full max-w-xs rounded-input border border-border-soft bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
          />
        </div>
      )}

      {phase === 'joining' && (
        <div className="border-b border-border bg-surface px-6 py-4">
          <label className="block text-xs font-medium uppercase tracking-wider text-muted">
            邀请码
          </label>
          <input
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            placeholder="6 位邀请码"
            maxLength={6}
            className="mt-2 w-full max-w-xs rounded-input border border-border-soft bg-bg px-3 py-2 text-center font-mono text-base tracking-[0.3em] text-text outline-none focus:border-accent/40"
          />
          {error && (
            <div className="mt-2 rounded-input bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {error}
            </div>
          )}
          <button
            className="mt-3 rounded-input bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
            onClick={handleJoin}
          >
            加入
          </button>
        </div>
      )}

      {/* Recent rooms as chat list */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          {recent.length === 0 && (
            <div className="mt-16 text-center text-sm text-muted">
              <p className="text-text">还没有会话</p>
              <p className="mt-1 text-xs">创建或加入一个会话，与远程客户端实时通信</p>
            </div>
          )}
          {recent.map((r) => (
            <div
              key={r.inviteCode}
              className="flex items-stretch overflow-hidden rounded-card border border-border bg-surface"
            >
              <button
                className="flex flex-1 items-center gap-3 px-3 py-2.5 text-left text-text hover:bg-surface-2"
                onClick={() => handlePickRecent(r.inviteCode)}
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent text-base font-semibold text-accent-fg">
                  {r.inviteCode[0]}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold tracking-[0.15em]">
                      {r.inviteCode}
                    </span>
                    <span className="text-[11px] text-muted">
                      {formatRelativeTime(r.lastVisitedAt)}
                    </span>
                  </span>
                  <span className="truncate text-xs text-muted">点击进入会话</span>
                </span>
              </button>
              <button
                className="flex w-9 flex-shrink-0 items-center justify-center border-l border-border-soft text-muted hover:bg-red-500/10 hover:text-red-500"
                title="从列表删除"
                onClick={() => handleRemoveRecent(r.inviteCode)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="border-t border-border bg-surface px-6 py-3">
        <div className="mx-auto flex max-w-2xl gap-3">
          <button
            className="flex flex-1 items-center justify-center gap-1.5 rounded-input bg-accent px-3 py-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
            onClick={handleCreate}
          >
            <Plus size={16} />
            创建会话
          </button>
          <button
            className="flex flex-1 items-center justify-center gap-1.5 rounded-input border border-border bg-surface px-3 py-2.5 text-sm font-medium text-text hover:bg-surface-2"
            onClick={() => setPhase('joining')}
          >
            <Radio size={16} />
            加入会话
          </button>
        </div>
      </div>

      {error && phase === 'list' && (
        <div className="mx-auto max-w-2xl px-6 pb-3">
          <div className="rounded-input bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</div>
        </div>
      )}
    </div>
  );
}

// ── Room Chat ────────────────────────────────────────────────────────────

function RoomChat({
  inviteCode,
  nickname,
  creatorInitEnforce,
  onLeave,
}: {
  inviteCode: string;
  nickname: string;
  creatorInitEnforce?: boolean;
  /** Called when the user leaves manually, or automatically after a fatal
      join error (e.g. the room was destroyed). errorMessage is only set for
      the auto-return path, so the list can surface the reason. */
  onLeave: (errorMessage?: string) => void;
}) {
  const [status, setStatus] = useState<RoomStatus>('connecting');
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [viewOnceMode, setViewOnceMode] = useState(false);
  const [viewingMessage, setViewingMessage] = useState<ChatMessage | null>(null);
  const [myMemberId, setMyMemberId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); // uploading or sending file
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  // "/" session-share picker state.
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState('');
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef<number>(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const myMemberIdRef = useRef('');

  // Keep a ref of myMemberId so the event handler closure sees the latest value.
  useEffect(() => {
    myMemberIdRef.current = myMemberId;
  }, [myMemberId]);

  // onLeave is an inline prop (new identity each render); the event-subscription
  // effect below must not re-subscribe on every render, so it reads the ref.
  const onLeaveRef = useRef(onLeave);
  useEffect(() => {
    onLeaveRef.current = onLeave;
  }, [onLeave]);

  // Join the room on mount.
  useEffect(() => {
    void roomJoin(
      inviteCode,
      nickname,
      creatorInitEnforce !== undefined ? { enforceViewOnce: creatorInitEnforce } : undefined,
    );
    return () => {
      void roomLeave();
    };
  }, [inviteCode, nickname, creatorInitEnforce]);

  // Subscribe to room events.
  useEffect(() => {
    const unsub = onRoomEvent((e: RoomEvent) => {
      switch (e.type) {
        case 'status':
          setStatus(e.status);
          setError(e.status === 'error' ? '连接异常，正在重连…' : '');
          break;
        case 'joined':
          joinedRef.current = true;
          setMembers(e.members);
          setMyMemberId(
            e.members.find((m) => m.nickname === nickname)?.id ??
              e.members[e.members.length - 1]?.id ??
              '',
          );
          // Sync room-level viewOnce flag and creator status from the relay.
          setEnforceViewOnce(e.enforceViewOnce === true);
          setIsCreator(e.isCreator === true);
          setDestroyExpiresAt(e.destroyExpiresAt);
          // Record this room in the recent list now that the relay accepted
          // our join (so the list reflects only rooms that still exist).
          recordRecentRoom(inviteCode, nickname);
          break;
        case 'member-joined':
          setMembers((cur) => [...cur, e.member]);
          break;
        case 'member-left':
          setMembers((cur) => cur.filter((m) => m.id !== e.memberId));
          break;
        case 'message': {
          const kind = (e.msg.kind ?? 'text') as 'text' | 'audio' | 'file' | 'session-share';
          const text = kind === 'text' || kind === 'session-share' ? decodeMessage(e.msg.ct) : '';
          const viewOnce = e.msg.viewOnce === true;
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
              viewOnce,
            },
          ]);
          // For regular (non-viewOnce) messages: ack "viewed" once on receipt
          // so the sender sees the "read" status. viewOnce messages are acked
          // when the recipient actually clicks to view.
          if (!viewOnce && e.msg.from !== myMemberIdRef.current) {
            if (!ackedRef.current.has(e.msg.messageId)) {
              ackedRef.current.add(e.msg.messageId);
              void roomViewed(e.msg.messageId);
            }
          }
          break;
        }
        case 'message-viewed':
          setMessages((cur) =>
            cur.map((m) => (m.messageId === e.messageId ? { ...m, viewed: true, read: true } : m)),
          );
          break;
        case 'view-once-changed':
          setEnforceViewOnce(e.enforce);
          // Reset per-message toggle so the room flag takes precedence.
          setViewOnceMode(false);
          break;
        case 'destroy-countdown':
          setDestroyExpiresAt(e.expiresAt);
          break;
        case 'destroyed':
          // The room is gone — return to the list (same path as a fatal
          // join error), surfaced via the list-level error line.
          onLeaveRef.current('房间已销毁');
          break;
        case 'error':
          setError(e.message);
          // A join-time error means the room is gone (destroyed). Show the
          // error briefly, then auto-return to the room list. Errors after a
          // successful join (e.g. permission errors) just surface the banner.
          if (!joinedRef.current && !returnTimerRef.current) {
            returnTimerRef.current = setTimeout(() => {
              returnTimerRef.current = null;
              onLeaveRef.current(e.message);
            }, 1500);
          }
          break;
      }
    });
    return () => {
      unsub();
      if (returnTimerRef.current) {
        clearTimeout(returnTimerRef.current);
        returnTimerRef.current = null;
      }
    };
  }, [nickname, inviteCode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // While a destruction countdown is active, tick once per second so the
  // banner's remaining time stays current.
  useEffect(() => {
    if (destroyExpiresAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [destroyExpiresAt]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || status !== 'joined') return;
    const willViewOnce = enforceViewOnce || viewOnceMode;
    try {
      const messageId = await roomSend(text, willViewOnce);
      setMessages((cur) => [
        ...cur,
        {
          messageId,
          from: myMemberId,
          fromMe: true,
          text,
          kind: 'text',
          at: Date.now(),
          viewOnce: willViewOnce,
        },
      ]);
      setInput('');
      if (!enforceViewOnce) setViewOnceMode(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送失败');
    }
  }, [input, status, viewOnceMode, enforceViewOnce, myMemberId]);

  // ── Session share ("/") ───────────────────────────────────────────────
  const handleShareSession = useCallback(
    async (session: { id: string; title: string }) => {
      const client = getClient();
      if (!client) {
        setShareError('请先选择设备');
        return;
      }
      setShareBusy(true);
      setShareError('');
      const willViewOnce = enforceViewOnce || viewOnceMode;
      try {
        const messages = await client.getMessages(session.id);
        const payload = compressSession(session.title, session.id, messages);
        const messageId = await roomSendSessionShare(payload, willViewOnce);
        setMessages((cur) => [
          ...cur,
          {
            messageId,
            from: myMemberId,
            fromMe: true,
            text: payload.summary,
            kind: 'session-share',
            meta: { sessionTitle: payload.title, sessionId: payload.sessionId },
            at: Date.now(),
            viewOnce: willViewOnce,
          },
        ]);
        setInput('');
        setShareOpen(false);
        if (!enforceViewOnce) setViewOnceMode(false);
      } catch (err) {
        setShareError(err instanceof Error ? err.message : '分享失败');
      } finally {
        setShareBusy(false);
      }
    },
    [enforceViewOnce, viewOnceMode, myMemberId],
  );

  // ── File attachment ─────────────────────────────────────────────────────
  const handlePickFile = useCallback(async () => {
    if (status !== 'joined' || busy) return;
    const willViewOnce = enforceViewOnce || viewOnceMode;
    try {
      const picked = await roomPickFile();
      if (!picked) return;
      setBusy(true);
      setError('');
      const { fileId } = await roomUploadFile(picked.path, {
        filename: picked.name,
        mime: picked.mime,
      });
      const meta: RoomMessageMeta = {
        filename: picked.name,
        size: picked.size,
        mime: picked.mime,
      };
      const messageId = await roomSendFile(fileId, 'file', meta, willViewOnce);
      setMessages((cur) => [
        ...cur,
        {
          messageId,
          from: myMemberId,
          fromMe: true,
          text: '',
          kind: 'file',
          fileId,
          meta,
          at: Date.now(),
          viewOnce: willViewOnce,
        },
      ]);
      if (!enforceViewOnce) setViewOnceMode(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '文件发送失败');
    } finally {
      setBusy(false);
    }
  }, [status, busy, viewOnceMode, enforceViewOnce, myMemberId]);

  // ── Voice recording (Electron renderer supports MediaRecorder) ─────────
  const startRecording = useCallback(async () => {
    if (status !== 'joined' || busy) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
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
        const willViewOnce = enforceViewOnce || viewOnceMode;
        try {
          setBusy(true);
          // Convert blob to base64 and send via IPC to the main process,
          // which uploads it to the relay.
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          const chunkSize = 0x8000;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(
              null,
              Array.from(bytes.subarray(i, i + chunkSize)) as unknown as number[],
            );
          }
          const base64 = btoa(binary);
          const { fileId } = await roomUploadBlob(base64, { mime, duration });
          const meta: RoomMessageMeta = { mime, size: blob.size, duration };
          const messageId = await roomSendFile(fileId, 'audio', meta, willViewOnce);
          setMessages((cur) => [
            ...cur,
            {
              messageId,
              from: myMemberId,
              fromMe: true,
              text: '',
              kind: 'audio',
              fileId,
              meta,
              at: Date.now(),
              viewOnce: willViewOnce,
            },
          ]);
          if (!enforceViewOnce) setViewOnceMode(false);
        } catch (e) {
          setError(e instanceof Error ? e.message : '语音上传失败');
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
      setError(e instanceof Error ? e.message : '无法访问麦克风');
    }
  }, [status, busy, viewOnceMode, enforceViewOnce, myMemberId]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
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
    // Ack once per message id; the message is burned after viewing so this
    // normally fires a single time, but guard against re-renders / re-mounts.
    if (!ackedRef.current.has(msg.messageId)) {
      ackedRef.current.add(msg.messageId);
      await roomViewed(msg.messageId);
    }
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
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  /** Format the remaining time until `expiresAt` as HH:MM:SS. */
  const formatCountdown = (expiresAt: number) => {
    const remain = Math.max(0, expiresAt - now);
    const totalSec = Math.floor(remain / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const online = status === 'joined';

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
            {online ? `${members.length} 人在线` : status === 'connecting' ? '连接中…' : '未连接'}
          </div>
        </div>
        {isCreator && (
          <button
            onClick={() => void roomSetViewOnce(!enforceViewOnce)}
            disabled={!online}
            title={enforceViewOnce ? '已开启房间阅后即焚' : '开启房间阅后即焚'}
            className={cn(
              'rounded-input border px-2.5 py-1 text-xs font-medium disabled:opacity-40',
              enforceViewOnce
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-border bg-surface-2 text-muted hover:text-text',
            )}
          >
            {enforceViewOnce ? '🔒 强制阅后即焚' : '🔓 默认模式'}
          </button>
        )}
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
      {destroyExpiresAt !== null && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-500">
          ⚠️ 创建者已离开，房间将在 {formatCountdown(destroyExpiresAt)} 后销毁
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
            <div
              key={m.messageId}
              className={cn('flex flex-col', m.fromMe ? 'items-end' : 'items-start')}
            >
              <div className="mb-0.5 px-1 text-xs text-muted">
                {members.find((x) => x.id === m.from)?.nickname ?? '未知'}
              </div>
              {m.viewOnce && !m.fromMe ? (
                <button
                  onClick={() => handleViewMessage(m)}
                  className="rounded-2xl border border-dashed border-accent bg-surface-2 px-3 py-2 text-left text-sm text-accent hover:bg-surface"
                >
                  <Lock size={12} className="mr-1 inline" />
                  阅后即焚消息 — 点击查看
                </button>
              ) : m.viewOnce && m.fromMe ? (
                <div
                  className={cn(
                    'rounded-2xl px-3 py-2 text-xs italic',
                    m.viewed ? 'bg-surface-2/50 text-muted' : 'bg-accent/30 text-accent',
                  )}
                >
                  {m.viewed ? '✓ 已查看' : '🔒 等待查看…'}
                </div>
              ) : (
                <MessageContent msg={m} fromMe={m.fromMe} />
              )}
              <div className="mt-0.5 flex items-center gap-1 px-1 text-[10px] text-muted">
                {formatTime(m.at)}
                {m.fromMe && !m.viewOnce && (m.read ? <span>· 已读</span> : <span>· 未读</span>)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-surface">
        {shareOpen && (
          <SessionSharePicker
            busy={shareBusy}
            error={shareError}
            onPick={(s) => void handleShareSession(s)}
            onClose={() => {
              setShareOpen(false);
              setShareError('');
            }}
          />
        )}
        <div className="px-4 py-3">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            {!enforceViewOnce && (
              <button
                onClick={() => setViewOnceMode(!viewOnceMode)}
                disabled={recording || busy}
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border',
                  viewOnceMode
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-border bg-surface-2 text-muted hover:text-text',
                )}
                title="阅后即焚"
              >
                <Lock size={15} />
              </button>
            )}
            <input
              value={input}
              onChange={(e) => {
                const v = e.target.value;
                setInput(v);
                // "/" opens the session-share picker (Slack-style command).
                setShareOpen(v.startsWith('/'));
                if (v.startsWith('/')) setShareError('');
              }}
              onKeyDown={(e) =>
                e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())
              }
              placeholder={
                enforceViewOnce
                  ? '强制阅后即焚消息…'
                  : viewOnceMode
                    ? '阅后即焚消息…'
                    : '输入消息…（/ 分享历史会话）'
              }
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

/** Format a byte size into a human-readable string. Module-level so
 *  MessageContent (a separate component from RoomChat) can use it. */
function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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
  const [audioError, setAudioError] = useState('');

  const loadAudio = async () => {
    if (audioPath || !msg.fileId) return;
    setAudioLoading(true);
    setAudioError('');
    try {
      const { path } = await roomDownloadFile(msg.fileId, `voice-${msg.messageId}.webm`);
      setAudioPath(path);
    } catch (e) {
      setAudioError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setAudioLoading(false);
    }
  };

  const handleSaveFile = async () => {
    if (!msg.fileId) return;
    try {
      await roomDownloadFile(msg.fileId, msg.meta?.filename);
    } catch (e) {
      setAudioError(e instanceof Error ? e.message : '下载失败');
    }
  };

  const bubble = cn(
    'rounded-2xl px-3 py-2 text-sm',
    embedded
      ? 'min-h-[60px] border border-border-soft bg-bg leading-relaxed'
      : fromMe
        ? 'max-w-[80%] rounded-tr-sm bg-accent text-accent-fg'
        : 'max-w-[80%] rounded-tl-sm border border-border bg-surface text-text',
  );

  if (msg.kind === 'audio') {
    return (
      <div className={cn(bubble, 'min-w-[180px]')}>
        {audioPath ? (
          <audio controls src={`file://${audioPath}`} className="w-full" />
        ) : (
          <button
            onClick={loadAudio}
            disabled={audioLoading}
            className="text-left text-xs hover:underline"
          >
            {audioLoading ? '加载中…' : `▶ 语音 ${msg.meta?.duration ?? 0}″`}
          </button>
        )}
        {audioError && <div className="mt-1 text-[10px] text-red-500">{audioError}</div>}
      </div>
    );
  }

  if (msg.kind === 'file') {
    return (
      <div className={bubble}>
        <button
          onClick={handleSaveFile}
          className="text-left text-xs text-accent hover:underline break-all"
        >
          📄 {msg.meta?.filename ?? '文件'} ({formatSize(msg.meta?.size)})
        </button>
      </div>
    );
  }

  if (msg.kind === 'session-share') {
    return <SessionShareCard msg={msg} />;
  }

  return <div className={cn(bubble, 'whitespace-pre-wrap break-words')}>{msg.text}</div>;
}

/** Collapsible card for a shared session: shows the title + preview, expands
 *  to reveal the compressed conversation summary. */
function SessionShareCard({ msg }: { msg: ChatMessage }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        'w-full max-w-[320px] overflow-hidden rounded-card border border-border bg-surface',
        open && 'max-w-[420px]',
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface-2"
      >
        <span>📎</span>
        <span className="min-w-0 flex-1 truncate font-semibold">
          会话分享：{msg.meta?.sessionTitle ?? '未命名会话'}
        </span>
        <span className="shrink-0 text-xs text-accent">{open ? '收起' : '展开查看'}</span>
      </button>
      {open && (
        <div className="max-h-80 overflow-y-auto border-t border-border bg-bg px-3 py-2">
          <MarkdownViewer variant="chat" className="text-xs leading-relaxed">
            {msg.text}
          </MarkdownViewer>
        </div>
      )}
    </div>
  );
}

/** "/" session-share picker: lists history sessions for the user to pick. */
function SessionSharePicker({
  busy,
  error,
  onPick,
  onClose,
}: {
  busy: boolean;
  error: string;
  onPick: (session: { id: string; title: string }) => void;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState<Array<{ id: string; title: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const client = getClient();
    if (!client) {
      setLoading(false);
      return;
    }
    client
      .listSessions()
      .then((list) => {
        if (!cancelled) setSessions(list);
      })
      .catch(() => {
        /* surfaced via parent error */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl border-b border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          分享历史会话
        </span>
        <button
          onClick={onClose}
          className="text-lg leading-none text-muted hover:text-text"
          aria-label="关闭"
        >
          ×
        </button>
      </div>
      {error && (
        <div className="border-b border-border px-4 py-1.5 text-xs text-red-500">{error}</div>
      )}
      {!getClient() && (
        <div className="border-b border-border px-4 py-1.5 text-xs text-red-500">
          请先在顶部选择设备
        </div>
      )}
      {loading ? (
        <div className="px-4 py-3 text-center text-xs text-muted">加载中…</div>
      ) : sessions.length === 0 ? (
        <div className="px-4 py-3 text-center text-xs text-muted">暂无历史会话</div>
      ) : (
        <div className="max-h-52 overflow-y-auto py-1">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => onPick(s)}
              disabled={busy}
              className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm text-text hover:bg-surface-2 disabled:opacity-50"
            >
              <span className="min-w-0 flex-1 truncate">{s.title || '未命名会话'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
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
    return '(无法解码)';
  }
}
