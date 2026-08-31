import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Mirror a source directory into a target, copying only files that changed
 *  (mtime/size) and deleting target files/dirs that no longer exist in the
 *  source. Same recursive semantics as `cp -r src dst` followed by a prune,
 *  but skips untouched files so a repeated profile deploy is near-free.
 *  Symbolic links are copied as-is (like cpSync default) rather than recursed. */
export function syncDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  const srcEntries = readdirSync(src, { withFileTypes: true });
  const srcNames = new Set(srcEntries.map((e) => e.name));
  // Prune stale target entries first (mirror semantics).
  if (existsSync(dst)) {
    for (const entry of readdirSync(dst, { withFileTypes: true })) {
      if (srcNames.has(entry.name)) continue;
      rmSync(join(dst, entry.name), { recursive: true, force: true });
    }
  }
  for (const entry of srcEntries) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) {
      syncDir(from, to);
      continue;
    }
    // Symlinks are copied as-is (cpSync default) — cheap, never diffed.
    if (entry.isSymbolicLink()) {
      cpSync(from, to);
      continue;
    }
    const srcStat = statSync(from);
    let needsCopy = true;
    try {
      const dstStat = statSync(to);
      needsCopy = dstStat.size !== srcStat.size || dstStat.mtimeMs !== srcStat.mtimeMs;
    } catch {
      // Target missing — copy.
    }
    if (needsCopy) cpSync(from, to);
  }
}
