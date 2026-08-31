import type {
  ArtifactContent,
  CreateTaskInput,
  DirEntry,
  ExecutionRecord,
  NotebookEntry,
  RelayHostStatusInfo,
  ScheduledTask,
  UpdateTaskInput,
  WorkspaceInfo,
} from './types';

/** Fetch implementation that tunnels through the relay WebSocket. Same shape
 *  as RelayHttpTransport.fetchImpl — the host intercepts /__host/* before the
 *  request would reach the sidecar, so we reuse the same transport. */
export type HostFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.error === 'string') msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

/** Typed wrapper around the `/__host/*` host API. All requests go through the
 *  relay (transparent forward) and are intercepted by RelayHost.handleHostApi
 *  on the desktop side — they never reach the OpenCode sidecar. */
export class HostClient {
  constructor(private fetch: HostFetch) {}

  // ── Workspace ────────────────────────────────────────────────────────
  async getWorkspace(): Promise<WorkspaceInfo> {
    return jsonOrThrow(await this.fetch('/__host/workspace'));
  }
  async setWorkspace(path: string): Promise<{ path: string }> {
    return jsonOrThrow(
      await this.fetch('/__host/workspace', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
      }),
    );
  }
  async newDatedWorkspace(name: string): Promise<{ path: string }> {
    return jsonOrThrow(
      await this.fetch('/__host/workspace/dated', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    );
  }
  async listDir(rel: string, root?: string): Promise<DirEntry[]> {
    const q = new URLSearchParams();
    if (rel) q.set('rel', rel);
    if (root) q.set('root', root);
    return jsonOrThrow(await this.fetch(`/__host/workspace/list?${q}`));
  }
  async readArtifact(path: string, root?: string): Promise<ArtifactContent | null> {
    const q = new URLSearchParams();
    if (path) q.set('path', path);
    if (root) q.set('root', root);
    return jsonOrThrow(await this.fetch(`/__host/artifact?${q}`));
  }
  async listNotebooks(root?: string): Promise<NotebookEntry[]> {
    const q = new URLSearchParams();
    if (root) q.set('root', root);
    return jsonOrThrow(await this.fetch(`/__host/notebooks?${q}`));
  }

  // ── Scheduler ────────────────────────────────────────────────────────
  async listTasks(): Promise<ScheduledTask[]> {
    return jsonOrThrow(await this.fetch('/__host/scheduler/tasks'));
  }
  async createTask(input: CreateTaskInput): Promise<ScheduledTask> {
    return jsonOrThrow(
      await this.fetch('/__host/scheduler/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  }
  async updateTask(id: string, patch: UpdateTaskInput): Promise<ScheduledTask | null> {
    return jsonOrThrow(
      await this.fetch(`/__host/scheduler/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    );
  }
  async deleteTask(id: string): Promise<void> {
    await jsonOrThrow(
      await this.fetch(`/__host/scheduler/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    );
  }
  async toggleTask(id: string, enabled: boolean): Promise<ScheduledTask | null> {
    return jsonOrThrow(
      await this.fetch(`/__host/scheduler/tasks/${encodeURIComponent(id)}/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }),
    );
  }
  async fireNow(id: string): Promise<ExecutionRecord | null> {
    return jsonOrThrow(
      await this.fetch(`/__host/scheduler/tasks/${encodeURIComponent(id)}/fire`, {
        method: 'POST',
      }),
    );
  }
  async getHistory(taskId?: string, limit?: number): Promise<ExecutionRecord[]> {
    const q = new URLSearchParams();
    if (taskId) q.set('taskId', taskId);
    if (limit != null) q.set('limit', String(limit));
    return jsonOrThrow(await this.fetch(`/__host/scheduler/history?${q}`));
  }
  async clearHistory(taskId?: string): Promise<void> {
    const q = new URLSearchParams();
    if (taskId) q.set('taskId', taskId);
    await jsonOrThrow(await this.fetch(`/__host/scheduler/history?${q}`, { method: 'DELETE' }));
  }

  // ── Relay status ─────────────────────────────────────────────────────
  async getRelayStatus(): Promise<RelayHostStatusInfo> {
    return jsonOrThrow(await this.fetch('/__host/relay/status'));
  }
}
