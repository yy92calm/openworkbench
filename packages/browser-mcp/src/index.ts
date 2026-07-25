/**
 * @fafawork/browser-mcp — Electron browser automation plugin for opencode.
 *
 * Main process entry point.
 * Renderer entry: @fafawork/browser-mcp/panel
 * Preload entry:  @fafawork/browser-mcp/preload
 * MCP server:     @fafawork/browser-mcp/mcp-server
 */

export { createBrowserMcp } from "./main/index";
export type { BrowserMcpOptions, BrowserMcpPlugin } from "./main/index";
