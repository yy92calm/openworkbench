/** Deployment entry for the relay server (public machine).
 *
 * Env:
 *   RELAY_AUTH_TOKEN  required — shared secret host & guest must present
 *   RELAY_PORT        default 8080
 *   RELAY_HOST        bind address, default 0.0.0.0
 *   RELAY_TLS_CERT    PEM cert path — enables https/wss
 *   RELAY_TLS_KEY     PEM key path (required together with RELAY_TLS_CERT)
 *   RELAY_STATIC_DIR  directory of the web client build to serve
 *   RELAY_ADMIN_PASSWORD  admin UI password (default test@123) — enables /api/admin/*
 *   RELAY_ADMIN_STATIC_DIR directory of the admin UI build (served at /relayadmin/)
 *
 * Run: pnpm serve  (or: tsx src/cli.ts)
 */
import { startRelayFromEnv } from "./server";

async function main(): Promise<void> {
  const relay = startRelayFromEnv();
  const port = await relay.listen();
  const scheme = relay.hasTls ? "https/wss" : "http/ws";
  console.log(`[relay] listening on ${scheme} :${port}`);
}

main().catch((err) => {
  console.error(`[relay] failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
