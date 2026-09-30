// Cross-platform directory links for the skill-enable feature.
//
// POSIX symlinks; on Windows a directory junction, which Node creates without
// requiring developer mode or elevation. Windows behaviour is untested here —
// the project's primary platform is macOS (see the plan's exclusion list).

import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname } from 'node:path';

/** Point `link` at the directory `target`, replacing whatever is there. */
export function linkDirectory(target: string, link: string): void {
  mkdirSync(dirname(link), { recursive: true });
  removeLink(link);
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

/** Remove a link. Idempotent — removing something that is not there is a no-op.
 *  Never recurses, so a real directory at `link` is left untouched (and a
 *  permissions problem surfaces instead of being silently masked). */
export function removeLink(link: string): void {
  rmSync(link, { force: true, recursive: false });
}
