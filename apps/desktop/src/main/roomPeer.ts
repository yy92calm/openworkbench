import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WebSocket } from 'ws';

import type {
  RelayMessage,
  RoomJoined,
  RoomMember,
  RoomMessageMeta,
  RoomMessageRouted,
} from './relay-protocol';
import { getStore } from './store';

export type RoomPeerStatus = 'off' | 'connecting' | 'joined' | 'error';

/** Normalize a relay URL to an http(s) base for `fetch`.
 *  The stored `relayUrl` may use `ws://` / `wss://` (for the WebSocket peer
 *  connection), but Node's `fetch` rejects non-http schemes. */
function httpBase(relayUrl: string): string {
  return relayUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
}

export interface RoomPeerConfig {
  relayUrl: string;
  token: string;
}

export type RoomPeerEvent =
  | { type: 'status'; status: RoomPeerStatus }
  | {
      type: 'joined';
      roomId: string;
      inviteCode: string;
      members: RoomMember[];
      enforceViewOnce: boolean;
      isCreator: boolean;
      destroyExpiresAt: number | null;
    }
  | { type: 'member-joined'; member: RoomMember }
  | { type: 'member-left'; memberId: string }
  | { type: 'message'; msg: RoomMessageRouted }
  | { type: 'message-viewed'; messageId: string }
  | { type: 'view-once-changed'; enforce: boolean }
  | { type: 'destroy-countdown'; expiresAt: number | null }
  | { type: 'destroyed' }
  | { type: 'error'; message: string };

/** Independent peer WebSocket connection for room chat. This is completely
 *  separate from RelayHost's host connection — it opens its own socket with
 *  ?role=peer and joins a room by invite code. The relay routes room
 *  messages over this socket; the host forwards them to the renderer via
 *  the event listener registered by the UI. */
export class RoomPeer {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private attempts = 0;
  private stopped = true;
  private status: RoomPeerStatus = 'off';
  private myMemberId = '';
  /** The creator's memberId, remembered so a rejoin after leaving identifies
   *  the creator to the relay (which then cancels the destruction countdown). */
  private myCreatorId = '';
  private inviteCode = '';
  private nickname = '';
  private members: RoomMember[] = [];
  /** Initial enforceViewOnce the creator wants on first join. Undefined
   *  means "not setting it" (regular members). */
  private enforceViewOnceInit: boolean | undefined;
  private readonly listeners = new Set<(e: RoomPeerEvent) => void>();

  private static readonly RECONNECT_BASE_MS = 1_000;
  private static readonly RECONNECT_MAX_MS = 30_000;

  getStatus(): RoomPeerStatus {
    return this.status;
  }

  getMyMemberId(): string {
    return this.myMemberId;
  }

  getInviteCode(): string {
    return this.inviteCode;
  }

  getMembers(): RoomMember[] {
    return this.members;
  }

  onEvent(cb: (e: RoomPeerEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: RoomPeerEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(e);
      } catch {
        /* listener errors are isolated */
      }
    }
  }

  private setStatus(next: RoomPeerStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.emit({ type: 'status', status: next });
  }

  /** Join a room by invite code. Opens a peer WebSocket to the relay and
   *  sends `room.join`. Returns immediately; listen via onEvent. */
  join(inviteCode: string, nickname: string, opts?: { enforceViewOnce?: boolean }): void {
    this.stop();
    this.inviteCode = inviteCode;
    this.nickname = nickname;
    this.enforceViewOnceInit = opts?.enforceViewOnce;
    this.stopped = false;
    this.attempts = 0;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.myMemberId = '';
    this.members = [];
    this.setStatus('off');
  }

  /** Create a room via HTTP, then join it. Returns the invite code. */
  async createRoom(): Promise<string> {
    const cfg = this.loadConfig();
    if (!cfg) throw new Error('relay not configured');
    const url = new URL('/api/rooms', httpBase(cfg.relayUrl));
    url.searchParams.set('token', cfg.token);
    const res = await fetch(url.toString(), { method: 'POST' });
    if (!res.ok) throw new Error(`create room failed: ${res.status}`);
    const data = (await res.json()) as { inviteCode?: string };
    if (!data.inviteCode) throw new Error('missing inviteCode in response');
    return data.inviteCode;
  }

  /** Validate an invite code via HTTP without joining. */
  async validateInvite(code: string): Promise<boolean> {
    const cfg = this.loadConfig();
    if (!cfg) throw new Error('relay not configured');
    const url = new URL(`/api/rooms/${encodeURIComponent(code)}`, httpBase(cfg.relayUrl));
    url.searchParams.set('token', cfg.token);
    const res = await fetch(url.toString());
    return res.ok;
  }

  private loadConfig(): RoomPeerConfig | null {
    try {
      // Relay config lives in the default settings store under the "relay"
      // key (same place index.ts / relayHost.ts read from).
      const relay = getStore().get('relay') as
        | Partial<{
            relayUrl: string;
            token: string;
          }>
        | undefined;
      if (!relay?.relayUrl || !relay?.token) return null;
      return { relayUrl: relay.relayUrl, token: relay.token };
    } catch {
      return null;
    }
  }

  private connect(): void {
    if (this.stopped || !this.inviteCode) return;
    const cfg = this.loadConfig();
    if (!cfg) {
      this.setStatus('error');
      this.emit({ type: 'error', message: 'relay not configured' });
      return;
    }
    this.setStatus('connecting');
    const url = new URL(cfg.relayUrl);
    url.searchParams.set('role', 'peer');
    url.searchParams.set('token', cfg.token);
    const ws = new WebSocket(url.toString());
    this.ws = ws;
    ws.on('open', () => {
      this.attempts = 0;
      // Send room.join immediately after opening.
      const joinMsg: Record<string, unknown> = {
        type: 'room.join',
        inviteCode: this.inviteCode,
        nickname: this.nickname,
      };
      if (this.enforceViewOnceInit !== undefined)
        joinMsg.enforceViewOnce = this.enforceViewOnceInit;
      // The creator carries their original memberId so a rejoin cancels the
      // destruction countdown and restores creator status.
      if (this.myCreatorId) joinMsg.creatorId = this.myCreatorId;
      ws.send(JSON.stringify(joinMsg as RelayMessage));
    });
    ws.on('message', (data) => void this.handleMessage(data));
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.myMemberId = '';
      if (!this.stopped) {
        this.setStatus('error');
        this.scheduleReconnect();
      }
    });
    ws.on('error', () => {
      if (!this.stopped) this.setStatus('error');
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(
      RoomPeer.RECONNECT_BASE_MS * 2 ** this.attempts,
      RoomPeer.RECONNECT_MAX_MS,
    );
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private async handleMessage(data: unknown): Promise<void> {
    let msg: RelayMessage | null = null;
    try {
      msg = JSON.parse(String(data)) as RelayMessage;
    } catch {
      return;
    }
    if (!msg) return;
    switch (msg.type) {
      case 'room.joined': {
        const j = msg as RoomJoined;
        // The relay assigns our member id. We identify ourselves as the last
        // member in the list (the one who just joined). If that fails, fall
        // back to matching by nickname.
        this.members = j.members;
        this.myMemberId =
          j.members.find((m) => m.nickname === this.nickname)?.id ??
          j.members[j.members.length - 1]?.id ??
          '';
        if (j.isCreator) this.myCreatorId = this.myMemberId;
        this.setStatus('joined');
        this.emit({
          type: 'joined',
          roomId: j.roomId,
          inviteCode: j.inviteCode,
          members: j.members,
          enforceViewOnce: j.enforceViewOnce === true,
          isCreator: j.isCreator === true,
          destroyExpiresAt: j.destroyExpiresAt ?? null,
        });
        break;
      }
      case 'room.member-joined':
        this.members = [...this.members, (msg as { member: RoomMember }).member];
        this.emit({ type: 'member-joined', member: (msg as { member: RoomMember }).member });
        break;
      case 'room.member-left': {
        const leftId = (msg as { memberId: string }).memberId;
        this.members = this.members.filter((m) => m.id !== leftId);
        this.emit({ type: 'member-left', memberId: leftId });
        break;
      }
      case 'room.message': {
        this.emit({ type: 'message', msg: msg as RoomMessageRouted });
        break;
      }
      case 'room.message-viewed':
        this.emit({ type: 'message-viewed', messageId: (msg as { messageId: string }).messageId });
        break;
      case 'room.view-once-changed':
        this.emit({ type: 'view-once-changed', enforce: (msg as { enforce: boolean }).enforce });
        break;
      case 'room.destroy-countdown':
        this.emit({
          type: 'destroy-countdown',
          expiresAt: (msg as { expiresAt: number | null }).expiresAt,
        });
        break;
      case 'room.destroyed':
        this.emit({ type: 'destroyed' });
        break;
      case 'room.error':
        this.emit({ type: 'error', message: (msg as { message: string }).message });
        this.setStatus('error');
        break;
      default:
        break;
    }
  }

  /** Send a text message to the room. Constructs per-recipient ciphertexts
   *  from the cached member list. Uses base64 encoding as a placeholder
   *  until real E2E crypto (X25519 + XChaCha20-Poly1305) is wired in. */
  sendMessage(text: string, opts?: { viewOnce?: boolean }): string {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('not connected to room');
    }
    const messageId = randomUUID();
    // TODO: replace with real E2E encryption (X25519 + XChaCha20-Poly1305).
    const encoded = Buffer.from(text, 'utf-8').toString('base64');
    const ciphertexts = this.members
      .filter((m) => m.id !== this.myMemberId)
      .map((m) => ({ to: m.id, nonce: '', ct: encoded }));
    const msg: RelayMessage = {
      type: 'room.message',
      messageId,
      ciphertexts,
      kind: 'text',
      viewOnce: opts?.viewOnce ?? false,
      at: Date.now(),
    };
    this.ws.send(JSON.stringify(msg));
    return messageId;
  }

  /** Upload a file blob to the relay. `filePath` points to a local file on
   *  disk (chosen via the renderer's FileDialog). Returns the fileId. */
  async uploadFile(
    filePath: string,
    meta: { filename?: string; mime?: string; duration?: number },
  ): Promise<string> {
    const cfg = this.loadConfig();
    if (!cfg) throw new Error('relay not configured');
    const data = await readFile(filePath);
    return this.uploadBuffer(data, meta);
  }

  /** Upload an in-memory buffer (e.g. a recorded voice blob from the
   *  renderer, base64-encoded for IPC transport). Returns the fileId. */
  async uploadBlob(
    base64Data: string,
    meta: { filename?: string; mime?: string; duration?: number },
  ): Promise<string> {
    const data = Buffer.from(base64Data, 'base64');
    return this.uploadBuffer(data, meta);
  }

  /** Internal: POST a raw buffer to the relay's upload endpoint. */
  private async uploadBuffer(
    data: Buffer,
    meta: { filename?: string; mime?: string; duration?: number },
  ): Promise<string> {
    const cfg = this.loadConfig();
    if (!cfg) throw new Error('relay not configured');
    const url = new URL(
      `/api/rooms/${encodeURIComponent(this.inviteCode)}/upload`,
      httpBase(cfg.relayUrl),
    );
    url.searchParams.set('token', cfg.token);
    if (meta.filename) url.searchParams.set('filename', meta.filename);
    if (meta.mime) url.searchParams.set('mime', meta.mime);
    if (meta.duration !== undefined) url.searchParams.set('duration', String(meta.duration));
    const res = await fetch(url.toString(), { method: 'POST', body: data });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    const out = (await res.json()) as { fileId: string };
    return out.fileId;
  }

  /** Send a file/audio message referencing an uploaded fileId. */
  sendFileMessage(
    fileId: string,
    kind: 'audio' | 'file',
    meta: RoomMessageMeta,
    opts?: { viewOnce?: boolean },
  ): string {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('not connected to room');
    }
    const messageId = randomUUID();
    const ciphertexts = this.members
      .filter((m) => m.id !== this.myMemberId)
      .map((m) => ({ to: m.id, nonce: '', ct: '' }));
    const msg: RelayMessage = {
      type: 'room.message',
      messageId,
      ciphertexts,
      kind,
      fileId,
      meta,
      viewOnce: opts?.viewOnce ?? false,
      at: Date.now(),
    };
    this.ws.send(JSON.stringify(msg));
    return messageId;
  }

  /** Send a compressed session share (kind="session-share"). The summary
   *  travels in `ct` (base64 plaintext, same as text messages until E2E);
   *  meta carries the source session's title/id for the card UI. */
  sendSessionShare(
    payload: { title: string; sessionId: string; summary: string },
    opts?: { viewOnce?: boolean },
  ): string {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('not connected to room');
    }
    const messageId = randomUUID();
    const encoded = Buffer.from(payload.summary, 'utf-8').toString('base64');
    const ciphertexts = this.members
      .filter((m) => m.id !== this.myMemberId)
      .map((m) => ({ to: m.id, nonce: '', ct: encoded }));
    const msg: RelayMessage = {
      type: 'room.message',
      messageId,
      ciphertexts,
      kind: 'session-share',
      meta: { sessionTitle: payload.title, sessionId: payload.sessionId },
      viewOnce: opts?.viewOnce ?? false,
      at: Date.now(),
    };
    this.ws.send(JSON.stringify(msg));
    return messageId;
  }

  /** Download a file blob by fileId to a temp directory. Returns the local
   *  file path so the renderer can open/save it. */
  async downloadFile(fileId: string, filename?: string): Promise<string> {
    const cfg = this.loadConfig();
    if (!cfg) throw new Error('relay not configured');
    const url = new URL(`/api/rooms/files/${encodeURIComponent(fileId)}`, cfg.relayUrl);
    url.searchParams.set('token', cfg.token);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // Save under a workbench-specific subfolder of the OS temp dir.
    const dir = join(tmpdir(), 'workbench-rooms');
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const safeName = (filename ?? fileId).replace(/[^A-Za-z0-9._-]/g, '_');
    const localPath = join(dir, `${fileId}-${safeName}`);
    await writeFile(localPath, buf);
    return localPath;
  }

  /** Reply that a viewOnce message was viewed. */
  replyViewed(messageId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: RelayMessage = {
      type: 'room.message-viewed',
      messageId,
    };
    this.ws.send(JSON.stringify(msg));
  }

  /** Creator: toggle the room's enforceViewOnce flag. The relay broadcasts
   *  `room.view-once-changed` to all members (including the creator). */
  roomSetViewOnce(enforce: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: RelayMessage = {
      type: 'room.set-view-once',
      enforce,
    };
    this.ws.send(JSON.stringify(msg));
  }
}

/** Singleton instance. The host renderer creates/destroys rooms through IPC;
 *  this object owns the actual WebSocket lifecycle. */
export const roomPeer = new RoomPeer();
