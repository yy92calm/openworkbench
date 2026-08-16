/** Room connection manager for the client.
 *
 * Opens a separate WebSocket to the relay with role=peer, joins a room by
 * invite code, and handles member/message events. This connection is
 * completely independent of the guest (request-forwarding) connection in
 * connection.ts — the two share nothing except the relay URL and token.
 *
 * Messages are NOT persisted: the message list lives in React state only.
 * Refresh the page and everything is gone — by design.
 *
 * E2E encryption is deferred to a later task. For now, message content is
 * base64-encoded plaintext in the `ct` field. When E2E is added, the same
 * field will hold the actual XChaCha20 ciphertext. */

import type {
  RoomJoined,
  RoomMemberJoined,
  RoomMemberLeft,
  RoomMessageRouted,
  RoomError,
  RoomMember,
} from "../protocol";
import { loadConfig } from "./connection";

export type RoomEvent =
  | { type: "joined"; data: RoomJoined }
  | { type: "member-joined"; data: RoomMemberJoined }
  | { type: "member-left"; data: RoomMemberLeft }
  | { type: "message"; data: RoomMessageRouted }
  | { type: "message-viewed"; messageId: string }
  | { type: "error"; message: string }
  | { type: "disconnected" };

export interface RoomMessageItem {
  messageId: string;
  from: string; // member id
  fromMe: boolean;
  text: string;
  kind: "text" | "audio" | "file";
  fileId?: string;
  meta?: { filename?: string; size?: number; mime?: string; duration?: number };
  at: number;
  viewOnce?: boolean;
  viewed?: boolean; // for viewOnce messages I sent — true after recipient viewed
}

let ws: WebSocket | null = null;
let myMemberId = "";
let inviteCode = "";
let members: RoomMember[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
const listeners = new Set<(e: RoomEvent) => void>();
const messageQueue: string[] = []; // messages queued before WS opens

function emit(e: RoomEvent): void {
  for (const cb of listeners) cb(e);
}

function wsUrl(relayWsUrl: string, token: string): string {
  // relayUrl may be http:// or ws:// — normalize to ws:// or wss://
  const wsBase = relayWsUrl
    .replace(/^http:\/\//, "ws://")
    .replace(/^https:\/\//, "wss://");
  return `${wsBase}?role=peer&token=${encodeURIComponent(token)}`;
}

function drainQueue(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  while (messageQueue.length > 0) {
    const msg = messageQueue.shift()!;
    ws.send(msg);
  }
}

function handleOpen(socket: WebSocket, code: string, nickname: string): void {
  // Send room.join as soon as the WS opens.
  const joinMsg = JSON.stringify({
    type: "room.join",
    inviteCode: code,
    nickname,
  });
  socket.send(joinMsg);
}

function handleMessage(data: string): void {
  let msg: { type?: string };
  try {
    msg = JSON.parse(data);
  } catch {
    return;
  }
  switch (msg.type) {
    case "room.joined": {
      const j = msg as unknown as RoomJoined;
      myMemberId = j.members[j.members.length - 1]?.id ?? "";
      members = j.members;
      inviteCode = j.inviteCode;
      emit({ type: "joined", data: j });
      break;
    }
    case "room.member-joined": {
      const m = msg as unknown as RoomMemberJoined;
      members = [...members, m.member];
      emit({ type: "member-joined", data: m });
      break;
    }
    case "room.member-left": {
      const m = msg as unknown as RoomMemberLeft;
      members = members.filter((x) => x.id !== m.memberId);
      emit({ type: "member-left", data: m });
      break;
    }
    case "room.message": {
      const m = msg as unknown as RoomMessageRouted;
      emit({ type: "message", data: m });
      break;
    }
    case "room.message-viewed": {
      const m = msg as unknown as { messageId: string };
      emit({ type: "message-viewed", messageId: m.messageId });
      break;
    }
    case "room.error": {
      const m = msg as unknown as RoomError;
      emit({ type: "error", message: m.message });
      break;
    }
  }
}

function scheduleReconnect(code: string, nickname: string): void {
  if (reconnectTimer) return;
  const delay = Math.min(1_000 * 2 ** attempts, 15_000);
  attempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void joinRoom(code, nickname);
  }, delay);
}

/** Join a room by invite code. Returns a cleanup function. */
export function joinRoom(code: string, nickname: string): () => void {
  const cfg = loadConfig();
  if (!cfg) throw new Error("not connected to relay");
  inviteCode = code;
  // Convert relayUrl (http/https) to ws/wss
  const cfgUrl = cfg.relayUrl;
  const url = wsUrl(cfgUrl, cfg.token);
  attempts = 0;
  ws = new WebSocket(url);
  ws.onopen = () => {
    attempts = 0;
    handleOpen(ws!, code, nickname);
    drainQueue();
  };
  ws.onmessage = (e) => {
    if (typeof e.data === "string") handleMessage(e.data);
  };
  ws.onclose = () => {
    ws = null;
    emit({ type: "disconnected" });
    // Auto-reconnect: the room may still exist on the relay.
    scheduleReconnect(code, nickname);
  };
  ws.onerror = () => {
    // onclose will fire next; let it handle reconnect.
  };
  return () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.onclose = null; // prevent reconnect on manual close
      ws.close();
      ws = null;
    }
    members = [];
    myMemberId = "";
  };
}

/** Subscribe to room events. Returns an unsubscribe function. */
export function onRoomEvent(cb: (e: RoomEvent) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Create a new room via HTTP. Returns the invite code. */
export async function createRoom(): Promise<string> {
  const cfg = loadConfig();
  if (!cfg) throw new Error("not connected to relay");
  const res = await fetch(`${cfg.relayUrl}/api/rooms?token=${encodeURIComponent(cfg.token)}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`create room failed: ${res.status}`);
  const data = (await res.json()) as { inviteCode: string };
  return data.inviteCode;
}

/** Validate an invite code via HTTP. */
export async function validateInvite(code: string): Promise<boolean> {
  const cfg = loadConfig();
  if (!cfg) throw new Error("not connected to relay");
  const res = await fetch(
    `${cfg.relayUrl}/api/rooms/${encodeURIComponent(code)}?token=${encodeURIComponent(cfg.token)}`,
  );
  return res.ok;
}

/** Send a text message to the room. E2E encryption is deferred — for now,
 *  the message is base64-encoded plaintext in the `ct` field. */
export function sendMessage(text: string, opts?: { viewOnce?: boolean }): string {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("not connected to room");
  }
  const messageId = crypto.randomUUID();
  const encoded = btoa(unescape(encodeURIComponent(text)));
  // Without E2E, all recipients get the same ciphertext.
  const ciphertexts = members
    .filter((m) => m.id !== myMemberId)
    .map((m) => ({ to: m.id, nonce: "", ct: encoded }));
  const msg = JSON.stringify({
    type: "room.message",
    messageId,
    ciphertexts,
    kind: "text",
    viewOnce: opts?.viewOnce ?? false,
    at: Date.now(),
  });
  ws.send(msg);
  return messageId;
}

/** Upload a binary blob (audio or file) to the relay and return the fileId.
 *  The caller then sends a room.message with kind=audio|file referencing it. */
export async function uploadRoomBlob(
  blob: Blob,
  meta: { filename?: string; mime?: string; duration?: number },
): Promise<string> {
  const cfg = loadConfig();
  if (!cfg) throw new Error("not connected to relay");
  const params = new URLSearchParams({ token: cfg.token });
  if (meta.filename) params.set("filename", meta.filename);
  if (meta.mime) params.set("mime", meta.mime);
  if (meta.duration !== undefined) params.set("duration", String(meta.duration));
  const res = await fetch(
    `${cfg.relayUrl}/api/rooms/${encodeURIComponent(inviteCode)}/upload?${params}`,
    { method: "POST", body: blob },
  );
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  const data = (await res.json()) as { fileId: string };
  return data.fileId;
}

/** Send a file or audio message referencing an uploaded fileId. The message
 *  carries no text payload — `ct` is empty; recipients fetch the blob via
 *  /api/rooms/files/:fileId using the fileId. */
export function sendFileMessage(
  fileId: string,
  kind: "audio" | "file",
  meta: { filename?: string; size?: number; mime?: string; duration?: number },
  opts?: { viewOnce?: boolean },
): string {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("not connected to room");
  }
  const messageId = crypto.randomUUID();
  // No per-recipient payload — file messages are out-of-band via HTTP.
  const ciphertexts = members
    .filter((m) => m.id !== myMemberId)
    .map((m) => ({ to: m.id, nonce: "", ct: "" }));
  const msg = JSON.stringify({
    type: "room.message",
    messageId,
    ciphertexts,
    kind,
    fileId,
    meta,
    viewOnce: opts?.viewOnce ?? false,
    at: Date.now(),
  });
  ws.send(msg);
  return messageId;
}

/** Download a file blob by fileId (for audio playback or file save). */
export async function downloadRoomBlob(fileId: string): Promise<Blob> {
  const cfg = loadConfig();
  if (!cfg) throw new Error("not connected to relay");
  const res = await fetch(
    `${cfg.relayUrl}/api/rooms/files/${encodeURIComponent(fileId)}?token=${encodeURIComponent(cfg.token)}`,
  );
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  return await res.blob();
}

/** Acknowledge that a viewOnce message was viewed. */
export function replyViewed(messageId: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "room.message-viewed", messageId }));
}

/** Leave the current room. */
export function leaveRoom(): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "room.leave" }));
  }
}

/** Current state. */
export function getMyMemberId(): string {
  return myMemberId;
}

export function getMembers(): RoomMember[] {
  return members;
}

export function getInviteCode(): string {
  return inviteCode;
}

/** Decode a message's `ct` field. For now (no E2E), it's base64 plaintext. */
export function decodeMessage(ct: string, _nonce: string, _fromPubKey?: string): string {
  try {
    return decodeURIComponent(escape(atob(ct)));
  } catch {
    return "[无法解码的消息]";
  }
}
