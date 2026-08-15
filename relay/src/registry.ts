import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  watch,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * Account registry: account token → registered devices.
 *
 * The token is the account credential. Devices are registered implicitly when
 * a host connects (host `device` id is stable across upgrades because the
 * desktop app persists it). Guests may only pair with devices registered under
 * their own token, so different accounts never share device ids.
 *
 * Persistence: when a dataDir is provided, the registry is written to
 * `accounts.json` on every mutation (memory is the source of truth, the file
 * only restores state across restarts), and the file is watched for changes
 * made by the admin CLI — a running relay hot-reloads account adds/removes
 * without a restart. Without a dataDir the registry is in-memory only.
 */
export interface AccountRecord {
  /** Human note (owner name, …) set via the admin CLI. */
  note?: string;
  /** Device ids that have appeared as hosts for this account. */
  devices: Set<string>;
}

export interface RegistryState {
  accounts: Record<string, AccountRecord>;
}

export function loadRegistry(dataDir?: string): RegistryState {
  if (!dataDir) return { accounts: {} };
  const file = join(dataDir, "accounts.json");
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, { note?: string; devices?: string[] }>;
    const accounts: Record<string, AccountRecord> = {};
    for (const [token, rec] of Object.entries(raw)) {
      accounts[token] = {
        note: rec?.note,
        devices: new Set(rec?.devices ?? []),
      };
    }
    return { accounts };
  } catch {
    return { accounts: {} };
  }
}

export class AccountRegistry {
  private readonly state: RegistryState;
  private readonly dataDir?: string;
  private readonly file?: string;
  private watcher: ReturnType<typeof watch> | null = null;
  /** Called when the on-disk file changed (admin CLI) and was reloaded. */
  private onChange: (() => void) | null = null;

  constructor(dataDir?: string, opts: { watch?: boolean } = {}) {
    this.state = loadRegistry(dataDir);
    this.dataDir = dataDir;
    this.file = dataDir ? join(dataDir, "accounts.json") : undefined;
    if (this.file && (opts.watch ?? true)) this.startWatching();
  }

  /** Optional callback fired after a hot reload (admin CLI wrote the file). */
  onFileChange(cb: () => void): void {
    this.onChange = cb;
  }

  /** Drop the file watcher (for clean test teardown). */
  dispose(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /** True when the token belongs to a registered account. */
  hasAccount(token: string): boolean {
    return !!this.state.accounts[token];
  }

  /** Device ids registered under the token (sorted for stable output). */
  listDevices(token: string): string[] {
    return [...this.state.accounts[token]?.devices ?? []].sort();
  }

  /** Mark a device as belonging to the account (idempotent). */
  registerDevice(token: string, device: string): void {
    const acc = this.state.accounts[token];
    if (!acc) return;
    if (!acc.devices.has(device)) {
      acc.devices.add(device);
      this.persist();
    }
  }

  /** True when the device is registered under the token. */
  hasDevice(token: string, device: string): boolean {
    return this.state.accounts[token]?.devices.has(device) ?? false;
  }

  /** Admin: remove a single device from an account. */
  unregisterDevice(token: string, device: string): void {
    const acc = this.state.accounts[token];
    if (!acc || !acc.devices.has(device)) return;
    acc.devices.delete(device);
    this.persist();
  }

  /** Admin: create/update an account. */
  upsertAccount(token: string, note?: string): void {
    const existing = this.state.accounts[token];
    this.state.accounts[token] = existing ?? { note, devices: new Set() };
    if (note !== undefined) this.state.accounts[token].note = note;
    this.persist();
  }

  /** Admin: remove an account (and all its devices). */
  removeAccount(token: string): boolean {
    if (!this.state.accounts[token]) return false;
    delete this.state.accounts[token];
    this.persist();
    return true;
  }

  /** All accounts, for the admin list CLI (token → note). */
  listAccounts(): Array<{ token: string; note?: string; deviceCount: number }> {
    return Object.entries(this.state.accounts)
      .map(([token, rec]) => ({
        token,
        note: rec.note,
        deviceCount: rec.devices.size,
      }))
      .sort((a, b) => a.token.localeCompare(b.token));
  }

  private persist(): void {
    if (!this.file) return;
    const out: Record<string, { note?: string; devices: string[] }> = {};
    for (const [token, rec] of Object.entries(this.state.accounts)) {
      out[token] = { note: rec.note, devices: [...rec.devices].sort() };
    }
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      // Write atomically: tmp + rename, so a crash never leaves a truncated
      // file that would wipe the registry on the next boot.
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(out, null, 2));
      renameSync(tmp, this.file);
    } catch {
      // Persistence failure must not break request forwarding — stay in memory.
    }
  }

  private startWatching(): void {
    // The file may not exist yet; watch the directory so first writes load.
    const dir = dirname(this.file!);
    if (!existsSync(dir)) {
      try { mkdirSync(dir, { recursive: true }); } catch { return; }
    }
    let reloading = false;
    const reload = () => {
      // Ignore reloads triggered by our own writes (rename replaces the file
      // in-place for the same path — this fires but the content is identical).
      if (reloading) return;
      reloading = true;
      try {
        const fresh = loadRegistry(this.dataDir);
        this.state.accounts = fresh.accounts;
        this.onChange?.();
      } finally {
        // Defer clearing so burst writes (tmp+rename) coalesce.
        setTimeout(() => { reloading = false; }, 50);
      }
    };
    try {
      this.watcher = watch(dir, (event, filename) => {
        if (event === "rename" || event === "change") {
          if (filename === "accounts.json") reload();
        }
      });
    } catch {
      // Some platforms can't watch; the registry still works, just no hot reload.
    }
  }
}