/** Relay server — server-side surface only. The client transport lives in the
 *  standalone `client/` directory (@workbench/client); this package owns the
 *  relay server, account registry, admin CLI and the wire protocol contract. */
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