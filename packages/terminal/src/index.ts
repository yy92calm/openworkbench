/**
 * @fafawork/terminal — Electron embedded terminal plugin.
 *
 * Main process: createTerminal() → { start(), stop() }
 * Renderer:      import { TerminalPanel } from "@fafawork/terminal/panel"
 */

export { createTerminal } from "./main/index";
export type { TerminalPlugin } from "./main/index";
