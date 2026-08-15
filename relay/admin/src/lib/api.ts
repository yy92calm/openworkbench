export interface AdminDevice {
  device: string;
  online: boolean;
}

export interface AdminAccount {
  token: string;
  note: string | null;
  devices: AdminDevice[];
}

/** Fetch wrapper that throws with the server's error message on bad status. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let message = `请求失败 (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep default message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

export function login(password: string): Promise<{ ok: boolean }> {
  return request("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
}

export function logout(): Promise<void> {
  return request("/api/admin/logout", { method: "POST" });
}

export function listAccounts(): Promise<{ accounts: AdminAccount[] }> {
  return request("/api/admin/accounts", { method: "GET" });
}

export function createAccount(token: string, note?: string): Promise<{ ok: boolean }> {
  return request("/api/admin/accounts", {
    method: "POST",
    body: JSON.stringify({ token, note }),
  });
}

export function deleteAccount(token: string): Promise<{ ok: boolean }> {
  return request(`/api/admin/accounts/${encodeURIComponent(token)}`, { method: "DELETE" });
}

export function deleteDevice(token: string, device: string): Promise<{ ok: boolean }> {
  return request(`/api/admin/accounts/${encodeURIComponent(token)}/devices/${encodeURIComponent(device)}`, {
    method: "DELETE",
  });
}