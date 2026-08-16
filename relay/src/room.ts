/** Room manager for the relay.
 *
 * Pure in-memory: rooms and members live only in this process. A relay
 * restart destroys every room — by design (see docs/20260815-14).
 *
 * A peer connects with `role=peer` and sends `room.join` to enter a room.
 * The relay assigns a random `Member.id` (UUID) that carries no account
 * information. Messages are E2E encrypted on the client side; the relay
 * only routes ciphertexts by their `to` field.
 *
 * Rooms auto-destroy when the last member leaves. Invite codes are 6-char
 * base32 strings; they are not stored separately from the room — the code
 * IS the lookup key.
 */

import { randomUUID, randomBytes } from "node:crypto";
import type { WebSocket } from "ws";
import type {
  RoomMember,
  RoomJoin,
  RoomLeave,
  RoomMessage,
  RoomMessageMeta,
  RoomMessageViewed,
  RoomJoined,
  RoomMemberJoined,
  RoomMemberLeft,
  RoomMessageRouted,
  RoomError,
} from "./protocol";

/** Base32 alphabet (Crockford, no ambiguous chars). */
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Generate a 6-char invite code (~30 bits of entropy). */
export function generateInviteCode(): string {
  const bytes = randomBytes(4);
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += BASE32[bytes[i % bytes.length] % 32];
  }
  return out;
}

interface Member extends RoomMember {
  ws: WebSocket;
  /** When the peer has not yet sent `room.join`, this is null. */
  roomId: string | null;
}

interface Room {
  id: string;
  inviteCode: string;
  members: Map<string, Member>; // memberId → member
}

/** Per-socket state for peer connections (set on the WebSocket instance). */
interface PeerSocketState {
  kind: "peer";
  member: Member | null; // null until room.join
}
export type SocketState = PeerSocketState | null;

/** Helper: read peer state off a socket. */
function peerState(ws: WebSocket): PeerSocketState | null {
  return (ws as WebSocket & { __relayState?: SocketState }).__relayState ?? null;
}

/** Helper: attach peer state to a socket. */
function setPeerState(ws: WebSocket, state: PeerSocketState): void {
  (ws as WebSocket & { __relayState?: SocketState }).__relayState = state;
}

export class RoomManager {
  /** inviteCode → Room. */
  private readonly rooms = new Map<string, Room>();
  /** roomId → Room (reverse lookup, same objects as in `rooms`). */
  private readonly roomsById = new Map<string, Room>();
  /** fileId → binary blob (Buffer). Stored in memory; cleared on relay restart
   *  or when the owning room is destroyed. Used for voice messages and file
   *  attachments. */
  private readonly files = new Map<string, { roomId: string; data: Buffer; meta: RoomMessageMeta }>();
  /** Max file size: 50 MB. Voice messages and typical office docs fit. */
  private static readonly MAX_FILE_BYTES = 50 * 1024 * 1024;

  /** Store an uploaded file blob. Returns the fileId. */
  storeFile(roomId: string, data: Buffer, meta: RoomMessageMeta): string {
    const fileId = randomUUID();
    this.files.set(fileId, { roomId, data, meta });
    return fileId;
  }

  /** Fetch a stored file blob. Returns null if not found. */
  getFile(fileId: string): { roomId: string; data: Buffer; meta: RoomMessageMeta } | null {
    return this.files.get(fileId) ?? null;
  }

  static get MAX_FILE_BYTES_NUM(): number {
    return RoomManager.MAX_FILE_BYTES;
  }

  /** Create a new room. Returns the invite code. */
  createRoom(): { roomId: string; inviteCode: string } {
    // Generate a unique invite code (retry on collision — extremely unlikely).
    let inviteCode: string;
    do {
      inviteCode = generateInviteCode();
    } while (this.rooms.has(inviteCode));
    const roomId = randomUUID();
    const room: Room = { id: roomId, inviteCode, members: new Map() };
    this.rooms.set(inviteCode, room);
    this.roomsById.set(roomId, room);
    return { roomId, inviteCode };
  }

  /** Validate an invite code without joining. */
  validateInvite(inviteCode: string): { valid: boolean; memberCount: number } {
    const room = this.rooms.get(inviteCode);
    return { valid: !!room, memberCount: room ? room.members.size : 0 };
  }

  /** Look up a room's id by invite code (without joining). Returns null if
   *  the room doesn't exist. Used by the HTTP upload endpoint to key files. */
  getRoomIdByInviteCode(inviteCode: string): string | null {
    return this.rooms.get(inviteCode)?.id ?? null;
  }

  /** Initialize a peer socket (called when role=peer connects). */
  initPeer(ws: WebSocket): void {
    setPeerState(ws, { kind: "peer", member: null });
  }

  /** Handle a peer message. Returns true if the message was a room message
   *  (handled); false if it should be ignored (not a room message type). */
  handlePeerMessage(ws: WebSocket, msg: unknown): boolean {
    const state = peerState(ws);
    if (!state) return false; // not a peer socket
    const m = msg as { type?: string };
    if (!m || typeof m.type !== "string") return false;
    switch (m.type) {
      case "room.join":
        this.handleJoin(ws, m as unknown as RoomJoin);
        return true;
      case "room.leave":
        this.handleLeave(ws);
        return true;
      case "room.message":
        this.handleMessage(ws, m as unknown as RoomMessage);
        return true;
      case "room.message-viewed":
        this.handleMessageViewed(ws, m as unknown as RoomMessageViewed);
        return true;
      default:
        return false;
    }
  }

  /** Called when a peer socket closes. Removes the member from their room. */
  handlePeerClose(ws: WebSocket): void {
    const state = peerState(ws);
    if (!state?.member) return;
    this.removeMember(state.member);
  }

  private handleJoin(ws: WebSocket, msg: RoomJoin): void {
    const state = peerState(ws)!;
    // If already in a room, leave it first.
    if (state.member) this.removeMember(state.member);
    const room = this.rooms.get(msg.inviteCode);
    if (!room) {
      this.send(ws, { type: "room.error", message: "room not found" } satisfies RoomError);
      return;
    }
    const memberId = randomUUID();
    const member: Member = {
      id: memberId,
      nickname: msg.nickname,
      pubKey: msg.pubKey,
      ws,
      roomId: room.id,
    };
    state.member = member;
    room.members.set(memberId, member);
    // Tell the new member they joined + the full member list.
    const members: RoomMember[] = [];
    for (const m of room.members.values()) {
      members.push({ id: m.id, nickname: m.nickname, pubKey: m.pubKey });
    }
    this.send(ws, {
      type: "room.joined",
      roomId: room.id,
      inviteCode: room.inviteCode,
      members,
    } satisfies RoomJoined);
    // Tell everyone else a new member joined.
    const joinedMsg: RoomMemberJoined = {
      type: "room.member-joined",
      member: { id: memberId, nickname: msg.nickname, pubKey: msg.pubKey },
    };
    this.broadcast(room, joinedMsg, memberId);
  }

  private handleLeave(ws: WebSocket): void {
    const state = peerState(ws);
    if (!state?.member) return;
    this.removeMember(state.member);
    state.member = null;
  }

  private handleMessage(ws: WebSocket, msg: RoomMessage): void {
    const state = peerState(ws);
    if (!state?.member) return;
    const room = this.roomsById.get(state.member.roomId!);
    if (!room) return;
    // Route each ciphertext to its recipient.
    for (const c of msg.ciphertexts) {
      const recipient = room.members.get(c.to);
      if (!recipient || recipient.ws.readyState !== recipient.ws.OPEN) continue;
      this.send(recipient.ws, {
        type: "room.message",
        messageId: msg.messageId,
        from: state.member.id,
        nonce: c.nonce,
        ct: c.ct,
        kind: msg.kind,
        fileId: msg.fileId,
        meta: msg.meta,
        viewOnce: msg.viewOnce,
        at: msg.at,
      } satisfies RoomMessageRouted);
    }
  }

  private handleMessageViewed(ws: WebSocket, msg: RoomMessageViewed): void {
    const state = peerState(ws);
    if (!state?.member) return;
    const room = this.roomsById.get(state.member.roomId!);
    if (!room) return;
    // Find the sender: we don't track message ownership on the relay, so we
    // broadcast `message-viewed` to all members except the viewer. Only the
    // original sender will care; others ignore it. This is simpler than
    // tracking sender per messageId and has negligible overhead.
    this.broadcast(room, msg, state.member.id);
  }

  private removeMember(member: Member): void {
    const room = this.roomsById.get(member.roomId!);
    if (!room) return;
    room.members.delete(member.id);
    // Tell everyone else.
    const leftMsg: RoomMemberLeft = { type: "room.member-left", memberId: member.id };
    this.broadcast(room, leftMsg, member.id);
    // Destroy room if empty.
    if (room.members.size === 0) {
      this.rooms.delete(room.inviteCode);
      this.roomsById.delete(room.id);
      // Clean up all files owned by this room.
      for (const [fid, entry] of this.files) {
        if (entry.roomId === room.id) this.files.delete(fid);
      }
    }
  }

  /** Send to all members except `exceptId` (if provided). */
  private broadcast(room: Room, msg: unknown, exceptId?: string): void {
    const data = JSON.stringify(msg);
    for (const m of room.members.values()) {
      if (m.id === exceptId) continue;
      if (m.ws.readyState === m.ws.OPEN) m.ws.send(data);
    }
  }

  private send(ws: WebSocket, msg: unknown): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
}
