/** Relay server — a standalone project (server-side surface only). The remote
 *  client (`client/`) and the Workbench host (`apps/desktop/`) are separate
 *  projects; each keeps its own copy of the wire protocol contract. This
 *  package owns the relay server, account registry, admin CLI and the
 *  authoritative wire protocol definition. */
export { RelayServer, startRelayFromEnv, type RelayServerOptions } from "./server";
export { AccountRegistry, loadRegistry, type AccountRecord, type RegistryState } from "./registry";
export type {
  RelayMessage,
  RelayRequest,
  RelayResponseHead,
  RelayChunk,
  RelayDone,
  RelayListDevices,
  RelayDeviceList,
  RelayDeviceInfo,
  RelayConnectionParams,
} from "./protocol";
export { parseConnectionParams } from "./protocol";