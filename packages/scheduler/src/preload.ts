/** @fafawork/scheduler — preload bridge for IPC. */

export const schedulerPreload = {
  schedulerList: () => (globalThis as any).ipcRenderer?.invoke("scheduler:list"),
  schedulerCreate: (task: unknown) => (globalThis as any).ipcRenderer?.invoke("scheduler:create", task),
  schedulerUpdate: (id: string, patch: unknown) => (globalThis as any).ipcRenderer?.invoke("scheduler:update", id, patch),
  schedulerDelete: (id: string) => (globalThis as any).ipcRenderer?.invoke("scheduler:delete", id),
  schedulerToggle: (id: string, enabled: boolean) => (globalThis as any).ipcRenderer?.invoke("scheduler:toggle", id, enabled),
  schedulerFireNow: (id: string) => (globalThis as any).ipcRenderer?.invoke("scheduler:fire-now", id),
  schedulerHistory: (taskId?: string, limit?: number) => (globalThis as any).ipcRenderer?.invoke("scheduler:history", taskId, limit),
};
