import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Audit snapshots of session transcripts captured at compaction boundaries.
 *  Counterpart of the model-side compaction (which only rewrites the model's
 *  history): the app keeps the raw transcript as evidence, Codex-style. */

const SNAPSHOT_DIR = 'compaction-snapshots';
const SNAPSHOT_CAP = 20;

export interface CompactionSnapshot {
  sessionId: string;
  historyVersion: number;
  triggeredAt: string;
  messages: unknown[];
}

/** Safely derive a filename-safe session key (sidecar ids are uuid-ish, but be
 *  defensive against anything that could walk out of the directory). */
function safeName(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Write one compaction snapshot under `snapshotsRoot/compaction-snapshots/` and
 * prune the oldest files for the same session above {@link SNAPSHOT_CAP}.
 * Returns the written file path, or null when the payload is empty.
 */
export function writeCompactionSnapshot(
  snapshotsRoot: string,
  snapshot: CompactionSnapshot,
): string | null {
  if (!snapshot.messages.length) return null;
  const dir = join(snapshotsRoot, SNAPSHOT_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const key = safeName(snapshot.sessionId);
  const file = join(dir, `${key}-${snapshot.historyVersion}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2), 'utf-8');

  prune(snapshotsRoot, key);
  return file;
}

/** Keep at most {@link SNAPSHOT_CAP} files for `key`, lowest version first. */
export function prune(snapshotsRoot: string, key: string): void {
  const dir = join(snapshotsRoot, SNAPSHOT_DIR);
  if (!existsSync(dir)) return;
  const prefix = `${safeName(key)}-`;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .sort((a, b) => {
      // The trailing number in `{key}-{version}.json` is the ordering signal;
      // `key` is in scope, so slicing the prefix yields the version exactly.
      const av = Number(a.slice(prefix.length, -'.json'.length));
      const bv = Number(b.slice(prefix.length, -'.json'.length));
      return (av || 0) - (bv || 0);
    });
  for (const file of files.slice(0, Math.max(0, files.length - SNAPSHOT_CAP))) {
    rmSync(join(dir, file), { force: true });
  }
}
