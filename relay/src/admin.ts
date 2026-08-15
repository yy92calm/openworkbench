/**
 * Admin CLI for the relay account registry.
 *
 * Shares the same account file as the running relay (RELAY_DATA_DIR); reads it
 * fresh on every invocation so it works while the relay is live, and writes
 * through the same registry (merge-on-write) so running-server state is never
 * clobbered.
 *
 * Usage:
 *   pnpm --filter @workbench/relay admin add --token <t> [--note <note>]
 *   pnpm --filter @workbench/relay admin list
 *   pnpm --filter @workbench/relay admin remove --token <t>
 *
 * Env: RELAY_DATA_DIR (required for persistence; without it the CLI operates
 *      on an in-memory registry, which is only useful for a same-process relay).
 */
import { AccountRegistry } from "./registry";

const USAGE = `用法:
  admin add --token <令牌> [--note <备注>]
  admin list
  admin remove --token <令牌>

环境变量: RELAY_DATA_DIR 指向中继的账号数据目录（与运行中的中继相同）`;

type Command =
  | { cmd: "add"; token: string; note?: string }
  | { cmd: "list" }
  | { cmd: "remove"; token: string };

function parseArgs(argv: string[]): Command | null {
  if (argv.length === 0) return null;
  const [cmd, ...rest] = argv;
  const get = (flag: string): string | undefined => {
    const i = rest.indexOf(flag);
    return i >= 0 && rest[i + 1] ? rest[i + 1] : undefined;
  };
  if (cmd === "add") {
    const token = get("--token");
    if (!token) return null;
    return { cmd, token, note: get("--note") };
  }
  if (cmd === "remove") {
    const token = get("--token");
    if (!token) return null;
    return { cmd, token };
  }
  if (cmd === "list") return { cmd };
  return null;
}

function main(): void {
  const dataDir = process.env.RELAY_DATA_DIR;
  if (!dataDir) {
    console.error("RELAY_DATA_DIR 未设置——管理 CLI 只在持久化模式下有意义。");
    console.error(USAGE);
    process.exit(1);
  }
  const cmd = parseArgs(process.argv.slice(2));
  if (!cmd) {
    console.error(USAGE);
    process.exit(1);
  }
  const reg = new AccountRegistry(dataDir, { watch: false });
  switch (cmd.cmd) {
    case "add": {
      reg.upsertAccount(cmd.token, cmd.note);
      console.log(`账号已添加: ${cmd.token}${cmd.note ? ` (${cmd.note})` : ""}`);
      break;
    }
    case "remove": {
      if (reg.removeAccount(cmd.token)) console.log(`账号已删除: ${cmd.token}`);
      else console.log(`账号不存在: ${cmd.token}`);
      break;
    }
    case "list": {
      const accounts = reg.listAccounts();
      if (accounts.length === 0) {
        console.log("(无账号)");
        break;
      }
      for (const a of accounts) {
        console.log(`${a.token}${a.note ? `\t(${a.note})` : ""}\t${a.deviceCount} 台设备`);
      }
      break;
    }
  }
}

main();