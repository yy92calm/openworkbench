/**
 * Preload bridge for the browser MCP plugin.
 *
 * Expose these via contextBridge in your preload script:
 *
 *   import { browserMcpPreload } from "@workbench/browser-mcp/preload";
 *   contextBridge.exposeInMainWorld("electronAPI", {
 *     ...browserMcpPreload,
 *     // ... your other APIs
 *   });
 */

export const browserMcpPreload = {
  // Browser command response (renderer → main)
  browserCommandResponse: (requestId: string, result: unknown) =>
    (globalThis as any).ipcRenderer?.invoke("browser:command-response", requestId, result),

  // Recording control (UI buttons)
  browserRecordStart: () => (globalThis as any).ipcRenderer?.invoke("browser:record-start"),
  browserRecordStop: () => (globalThis as any).ipcRenderer?.invoke("browser:record-stop"),
  browserRecordState: () => (globalThis as any).ipcRenderer?.invoke("browser:record-state"),
  browserRecordSave: (name: string, description?: string) =>
    (globalThis as any).ipcRenderer?.invoke("browser:record-save", name, description),
  browserRecordList: () => (globalThis as any).ipcRenderer?.invoke("browser:record-list"),
  browserRecordReplay: (name: string, delay?: number) =>
    (globalThis as any).ipcRenderer?.invoke("browser:record-replay", name, delay),

  // Webview setup
  browserSetupWebview: (wcId: number) =>
    (globalThis as any).ipcRenderer?.invoke("browser:setup-webview", wcId),

  // Panel control
  browserFetch: (url: string) => (globalThis as any).ipcRenderer?.invoke("browser:fetch", url),
};

/** IPC event listener helper (for browser:panel / browser:command channels). */
export function createIpcListener(ipcRenderer: any) {
  return {
    on: (channel: string, callback: (...args: unknown[]) => void) => {
      const handler = (_event: unknown, ...args: unknown[]) => callback(...args);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  };
}
