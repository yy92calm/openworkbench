// Crash-safe file writes for the app's small JSON state files, plus the
// "quarantine instead of silently rebuild" policy for files the user owns.
//
// Motivation (ported from OC Manager's internal/fileutil): a plain
// writeFileSync truncates the target first, so a crash or power loss mid-write
// leaves a half-written file that the next read parses as corrupt — and for
// user-authored state (config patch, scheduler tasks, decision ledger) a
// silent rebuild is data loss, not a graceful degradation.

import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Write `data` so the target is never observed half-written: write to a temp
 * file in the *same directory* (same filesystem, so the rename is atomic),
 * fsync the data to disk, then rename over the target.
 */
export function atomicWriteFile(path: string, data: string | Uint8Array): void {
  const tmp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now().toString(36)}.tmp`,
  );
  const fd = openSync(tmp, 'wx', 0o644);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* the temp file is already gone */
    }
    throw err;
  }
}

/** Move a corrupt file aside as `<name>.corrupt-<timestamp>`. Returns the new
 *  path, or null when the rename failed (caller still degrades gracefully). */
export function quarantineFile(path: string): string | null {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const aside = `${path}.corrupt-${stamp}`;
  try {
    renameSync(path, aside);
    return aside;
  } catch {
    return null;
  }
}

/** Read + JSON.parse a file; a missing file is a normal first run and yields
 *  `fallback`. A corrupt file is quarantined (never silently overwritten) and
 *  also yields `fallback`. */
export function readJsonFile<T>(path: string, fallback: T): T {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    quarantineFile(path);
    return fallback;
  }
}
