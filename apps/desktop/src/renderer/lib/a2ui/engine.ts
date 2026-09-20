/**
 * A2UI engine — one MessageProcessor per session, fed from agent text parts.
 *
 * Surfaces are shared across blocks: a later part may update a surface an
 * earlier part created (`updateComponents` references an existing surfaceId),
 * so the processor (and its surface ownership) lives here, outside React.
 * The engine only holds protocol state; rendering is done by the Lit renderer
 * in the thread components.
 */

import type { LitComponentApi } from '@a2ui/lit/v0_9';
import { basicCatalog } from '@a2ui/lit/v0_9';
import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import type { HistoryMessage } from '@workbench/sdk';

import { extractA2ui } from './parser';

/** A surface model the Lit renderer can draw (catalog carries tagNames). */
export type A2uiSurfaceModel = SurfaceModel<LitComponentApi>;

/** Deterministic part key when a thread is rebuilt from history: message
 *  index + part index within that message. historyToThread stamps the same
 *  key on agent blocks so surfaces remount at the same position. */
export function historyA2uiPartKey(messageIndex: number, partIndex: number): string {
  return `h${messageIndex}-p${partIndex}`;
}

interface PartState {
  /** How many complete JSON values of this part have been processed. */
  fed: number;
}

interface SessionEntry {
  processor: MessageProcessor<LitComponentApi>;
  parts: Map<string, PartState>;
  /** surfaceId → partKey of the part whose createSurface claimed it. */
  owners: Map<string, string>;
  /** Surface ids in claim order (stable mount order per part). */
  order: string[];
}

class A2uiEngine {
  private readonly sessions = new Map<string, SessionEntry>();

  private entry(sessionId: string): SessionEntry {
    let e = this.sessions.get(sessionId);
    if (!e) {
      e = {
        processor: new MessageProcessor([basicCatalog]),
        parts: new Map(),
        owners: new Map(),
        order: [],
      };
      this.sessions.set(sessionId, e);
    }
    return e;
  }

  /** Feed the current full text of one part. Exactly-once per message: only
   *  values beyond the fed count are processed, so identical replays (upsert
   *  deltas, reconnects, history reloads) feed nothing new. */
  feedText(sessionId: string, partKey: string, text: string): void {
    const e = this.entry(sessionId);
    const { messages } = extractA2ui(text);
    const part = e.parts.get(partKey) ?? { fed: 0 };
    // Upserts only ever grow a part's text; if one ever shrank, re-feeding
    // earlier messages is safe (duplicate createSurface claims fail, updates
    // are idempotent replaces) — just restart the counter.
    if (messages.length < part.fed) part.fed = messages.length;
    for (let i = part.fed; i < messages.length; i++) {
      this.processMessage(e, partKey, messages[i]);
    }
    part.fed = messages.length;
    e.parts.set(partKey, part);
  }

  /** Feed every agent text part of a loaded history (mirrors historyToThread:
   *  same message/part ordering, same synthetic keys). Idempotent — parts
   *  already fed live are skipped by their fed counter. */
  ingestHistory(sessionId: string, messages: HistoryMessage[]): void {
    messages.forEach((m, mi) => {
      if (m.role !== 'assistant') return;
      m.parts.forEach((p, pi) => {
        if (p.type === 'text' && p.text) {
          this.feedText(sessionId, historyA2uiPartKey(mi, pi), p.text);
        }
      });
    });
  }

  /** Surfaces this part owns, in creation order — what its block renders. */
  claimedSurfaces(sessionId: string, partKey: string): A2uiSurfaceModel[] {
    const e = this.sessions.get(sessionId);
    if (!e) return [];
    const out: A2uiSurfaceModel[] = [];
    for (const id of e.order) {
      if (e.owners.get(id) !== partKey) continue;
      const s = e.processor.model.surfacesMap.get(id);
      if (s) out.push(s);
    }
    return out;
  }

  /** Drop all per-session state (session deleted). */
  dropSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private processMessage(e: SessionEntry, partKey: string, msg: unknown): void {
    const m = msg as {
      createSurface?: { surfaceId?: unknown };
      deleteSurface?: { surfaceId?: unknown };
    };
    const createdId =
      typeof m?.createSurface?.surfaceId === 'string' ? m.createSurface.surfaceId : undefined;
    if (createdId !== undefined && !e.owners.has(createdId)) {
      // Claim before processing: on failure (duplicate, invalid) the claim
      // rolls back so a later valid createSurface can still claim it.
      e.owners.set(createdId, partKey);
      e.order.push(createdId);
      try {
        e.processor.processMessage(m);
      } catch {
        e.owners.delete(createdId);
        e.order.pop();
      }
      return;
    }
    if (
      typeof m?.deleteSurface?.surfaceId === 'string' &&
      e.owners.has(m.deleteSurface.surfaceId)
    ) {
      // Surface gone — release the claim so a later createSurface with the
      // same id mounts under the part that actually recreated it.
      const id = m.deleteSurface.surfaceId;
      e.owners.delete(id);
      e.order = e.order.filter((x) => x !== id);
    }
    try {
      e.processor.processMessage(m);
    } catch {
      // Invalid message (e.g. an update for a surface we do not own) — the
      // protocol is agent-generated, drop quietly rather than break the turn.
    }
  }
}

/** Renderer-lifetime singleton; sessions keyed by opencode session id. */
export const a2uiEngine = new A2uiEngine();
