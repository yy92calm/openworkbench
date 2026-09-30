// Whether the app is really quitting, as opposed to its window merely being
// hidden. Dependency-free on purpose: both the window (which intercepts close)
// and the tray (which asks for a quit) need to read it, and importing either
// from the other would create a cycle.

let quitting = false;

/** Flag a real quit so the window's close interceptor stands down. Called from
 *  `before-quit`, which Electron emits before it starts closing windows. */
export function markQuitting(): void {
  quitting = true;
}

export function isQuitting(): boolean {
  return quitting;
}
