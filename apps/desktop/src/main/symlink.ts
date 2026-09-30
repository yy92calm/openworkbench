// Cross-platform directory links for the skill-enable feature.
//
// POSIX: a symlink to the directory. Windows: a *directory junction*, which
// Node creates without developer mode or elevation (Windows symlinks need
// either). Both are removed by the same rules, and neither removal may ever
// touch the target — that is the property the tests pin down.

import { mkdirSync, rmdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

/** Point `link` at the directory `target`, replacing whatever is there. */
export function linkDirectory(target: string, link: string): void {
  mkdirSync(dirname(link), { recursive: true });
  removeLink(link);
  // 'junction' asks Node for a reparse point that needs no privileges; it
  // normalises the target to an absolute path, which Windows requires.
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

/**
 * Remove a link. Idempotent, and never recursive: a link is a pointer, so
 * dropping it must leave the target directory untouched. A *real* directory
 * sitting at `link` is refused (non-empty surfaces as an error) rather than
 * deleted — a plain file at that name is replaced, which matches POSIX `rm
 * --force` behaviour.
 */
export function removeLink(link: string): void {
  if (process.platform !== 'win32') {
    // force+non-recursive: missing is fine, and a directory is never descended
    // into. A symlink is removed without following it.
    rmSync(link, { force: true, recursive: false });
    return;
  }
  // Windows: rmdir drops the junction itself and does not recurse into the
  // target. A plain file at that name reports ENOTDIR, so it is unlinked.
  try {
    rmdirSync(link);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    if (code === 'ENOTDIR') {
      unlinkSync(link);
      return;
    }
    throw err;
  }
}
