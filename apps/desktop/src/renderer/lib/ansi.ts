/**
 * Display-side ANSI escape stripping (docs/20260906-03-codex-output-and-artifacts.md).
 *
 * Codex convention: stored output keeps its raw bytes; only renderers convert
 * ANSI (codex-rs/ansi-escape feeds a styled TUI). This app's plain-text spots
 * have no terminal renderer, so the escapes are removed at display time —
 * storage (provenance JSONL, session history) is never touched.
 */

/* eslint-disable no-control-regex -- static ANSI patterns; the rule targets
 *  control characters from user input, and these sequences must be literal. */
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const CHARSET = /\x1b[()][0-9A-Z]/g;
const MISC = /\x1b[=>]/g;
/* eslint-enable no-control-regex */

/** Remove ANSI escape sequences (SGR colors, cursor/erase CSI, OSC titles,
 *  charset selection). Plain text passes through untouched. */
export function stripAnsi(text: string): string {
  return text.replace(OSC, '').replace(CSI, '').replace(CHARSET, '').replace(MISC, '');
}
