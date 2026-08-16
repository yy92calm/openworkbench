/** Wire protocol for the Workbench remote relay.
 *
 * Messages are JSON text frames on the WebSocket. Three roles:
 *  - host  (the machine running the Workbench sidecar)
 *  - guest (the remote client — Web/PWA or Electron)
 *  - peer  (a room member — host or client participating in a chat room)
 *
 * Flow: guest sends a request, the relay routes it to the host, the host
 * replies with head → (chunk)* → done. The relay itself is a pure byte
 * forwarder: it never parses payloads and keeps no request content.
 *
 * Peer connections are independent of host/guest: they join rooms by invite
 * code and exchange broadcast messages. Messages are E2E encrypted on the
 * client side; the relay only routes ciphertexts.
 */

/** Guest → host: an HTTP request to perform against the local sidecar. */
export interface RelayRequest {
  type: "request";
  /** Unique request id — enables concurrent requests on one socket. */
  id: string;
  method: string;
  /** Path + query, e.g. "/session/abc/message?directory=/ws" */
  path: string;
  headers?: Record<string, string>;
  /** UTF-8 text body (the sidecar API is JSON/SSE text only). */
  body?: string;
}

/** Host → guest: response status line. Always precedes chunks. */
export interface RelayResponseHead {
  type: "head";
  id: string;
  status: number;
  headers: Record<string, string>;
}

/** Host → guest: one body chunk (SSE frames ride these). */
export interface RelayChunk {
  type: "chunk";
  id: string;
  chunk: string;
}

/** Host → guest: response finished; the guest closes the fetch stream. */
export interface RelayDone {
  type: "done";
  id: string;
}

/** Guest → relay (control): list the devices registered under the account
 *  (only valid on a guest connection without a device, i.e. device="" ). */
export interface RelayListDevices {
  type: "list-devices";
  id: string;
}

/** One registered device in a device-list reply. */
export interface RelayDeviceInfo {
  device: string;
  /** Whether the device's host is currently connected to the relay. */
  online: boolean;
}

/** Relay → guest: reply to list-devices. */
export interface RelayDeviceList {
  type: "device-list";
  id: string;
  devices: RelayDeviceInfo[];
}

/** Relay → host: cancel an in-flight forwarded request. Sent when the guest
 *  that started it disconnects, so the host aborts the sidecar fetch instead
 *  of leaving it (e.g. an SSE stream) hanging forever and leaking connections. */
export interface RelayCancel {
  type: "cancel";
  id: string;
}

// ── Room (peer) messages ─────────────────────────────────────────────────
// E2E encrypted broadcast chat between room members. The relay only sees
// ciphertexts and routing metadata; it cannot decrypt message contents.

/** A room member. `id` is assigned by the relay (random UUID); it carries no
 *  account/token/device information. `pubKey` is the member's X25519 public
 *  key (base64), used for E2E key agreement. */
export interface RoomMember {
  id: string;
  nickname?: string;
  pubKey?: string;
}

/** One encrypted payload addressed to a specific member. The relay routes
 *  by `to` without ever seeing the plaintext. */
export interface RoomCiphertext {
  to: string;
  nonce: string;
  ct: string;
}

/** Peer → relay: join a room by invite code. Carries the peer's nickname and
 *  X25519 public key for E2E key agreement. */
export interface RoomJoin {
  type: "room.join";
  inviteCode: string;
  nickname?: string;
  pubKey?: string;
}

/** Peer → relay: leave the current room. */
export interface RoomLeave {
  type: "room.leave";
}

/** Peer → relay: broadcast an E2E encrypted message to all other members.
 *  `ciphertexts` has one entry per recipient; the relay routes each entry
 *  to its `to` member.
 *
 *  `kind` indicates the message payload type:
 *  - "text": plain text chat message
 *  - "audio": voice message (fileId references uploaded audio binary)
 *  - "file": file attachment (fileId references uploaded binary; meta carries name/size/mime)
 *  `meta` carries optional metadata (filename, size, mime, duration for audio). */
export interface RoomMessageMeta {
  filename?: string;
  size?: number;
  mime?: string;
  /** Audio duration in seconds (for "audio" kind). */
  duration?: number;
}

export interface RoomMessage {
  type: "room.message";
  messageId: string;
  ciphertexts: RoomCiphertext[];
  kind?: "text" | "audio" | "file";
  /** For audio/file messages: the upload id returned by /api/rooms/:code/upload.
   *  The relay stores the binary blob in memory and serves it on
   *  /api/rooms/files/:fileId. Recipients fetch it after receiving the message.
   *  For text messages, this is undefined. */
  fileId?: string;
  meta?: RoomMessageMeta;
  /** When true, the recipient should view once and reply `room.message-viewed`. */
  viewOnce?: boolean;
  at: number;
}

/** Peer → relay → sender: acknowledge that a viewOnce message was viewed.
 *  The relay forwards this to the original sender only. */
export interface RoomMessageViewed {
  type: "room.message-viewed";
  messageId: string;
}

/** Relay → peer: join succeeded. Returns the room id, invite code, and the
 *  full member list (including the joining peer). */
export interface RoomJoined {
  type: "room.joined";
  roomId: string;
  inviteCode: string;
  members: RoomMember[];
}

/** Relay → peer: a new member joined the room. */
export interface RoomMemberJoined {
  type: "room.member-joined";
  member: RoomMember;
}

/** Relay → peer: a member left the room. */
export interface RoomMemberLeft {
  type: "room.member-left";
  memberId: string;
}

/** Relay → peer: a broadcast message routed to this member. Contains only
 *  this member's ciphertext entry (not the full ciphertexts array). */
export interface RoomMessageRouted {
  type: "room.message";
  messageId: string;
  from: string;
  nonce: string;
  ct: string;
  kind?: "text" | "audio" | "file";
  fileId?: string;
  meta?: RoomMessageMeta;
  viewOnce?: boolean;
  at: number;
}

/** Relay → peer: error (e.g. unknown invite code, not in a room). */
export interface RoomError {
  type: "room.error";
  message: string;
}

export type RelayMessage =
  | RelayRequest
  | RelayResponseHead
  | RelayChunk
  | RelayDone
  | RelayListDevices
  | RelayDeviceList
  | RelayCancel
  | RoomJoin
  | RoomLeave
  | RoomMessage
  | RoomMessageViewed
  | RoomJoined
  | RoomMemberJoined
  | RoomMemberLeft
  | RoomMessageRouted
  | RoomError;

/** Connection query params:
 *  - host:  ?role=host&token=<token>&device=<deviceId>
 *  - guest: ?role=guest&token=<token>[&device=<deviceId>]
 *  - peer:  ?role=peer&token=<token>
 *
 *  Peer connections send a `room.join` message right after opening to join a
 *  specific room by invite code (carrying nickname + pubKey). The relay does
 *  not add the peer to any room until `room.join` arrives. */
export interface RelayConnectionParams {
  role: "host" | "guest" | "peer";
  device: string;
  token: string;
}

export function parseConnectionParams(url: string): RelayConnectionParams | null {
  try {
    // req.url is a relative path (no host) — supply a base for URL parsing.
    const u = new URL(url, "http://relay.local");
    const role = u.searchParams.get("role");
    const token = u.searchParams.get("token");
    if (role !== "host" && role !== "guest" && role !== "peer") return null;
    if (!token) return null;
    return { role, device: u.searchParams.get("device") ?? "", token };
  } catch {
    return null;
  }
}
